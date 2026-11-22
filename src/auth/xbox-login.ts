import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

export type LoginPhase = 'signed_out' | 'signing_in' | 'awaiting_code' | 'signed_in' | 'failed';

export type LoginErrorKind =
  | 'interactive_required'
  | 'cancelled'
  | 'code_expired'
  | 'no_xbox_profile'
  | 'child_account'
  | 'region_blocked'
  | 'adult_verification'
  | 'network'
  | 'unknown';

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  message?: string;
}

export interface LoginEvent {
  phase: LoginPhase;
  message: string;
  code?: DeviceCodeInfo;
  errorKind?: LoginErrorKind;
}

/** Safe to show in UI or logs: the message is fixed text and never contains tokens. */
export class LoginError extends Error {
  readonly kind: LoginErrorKind;
  constructor(kind: LoginErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LoginError';
    this.kind = kind;
  }
}

export interface RawDeviceCode {
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  message?: string;
}

/** The slice of prismarine-auth's Authflow this service needs. */
export interface AuthflowLike {
  getXboxToken(): Promise<unknown>;
}

export type AuthflowFactory = (username: string, cacheDir: string, onCode: (code: RawDeviceCode) => void) => AuthflowLike;

export interface XboxLoginConfig {
  /** Cache key for the saved tokens. Not a password. */
  username: string;
  /** Absolute, app-private folder where tokens are saved. Deleted on sign-out. */
  cacheDir: string;
  authflowFactory?: AuthflowFactory;
}

export interface SignInOptions {
  /** false = never show a code; fail with 'interactive_required' if saved tokens are not enough. Default true. */
  interactive?: boolean;
  signal?: AbortSignal;
}

const FRIENDLY: Record<LoginErrorKind, string> = {
  interactive_required: 'Sign-in is required.',
  cancelled: 'Sign-in was cancelled.',
  code_expired: 'The sign-in code expired. Start sign-in again.',
  no_xbox_profile: 'This Microsoft account has no Xbox profile. Create one at xbox.com, then try again.',
  child_account: 'This is a child account. An adult must add it to a Microsoft family group before it can play online.',
  region_blocked: 'Xbox Live is not available in this account\'s region.',
  adult_verification: 'This account needs adult verification before it can use Xbox Live.',
  network: 'Network problem while contacting Microsoft. Check the connection and retry.',
  unknown: 'Xbox sign-in failed.'
};

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error) ?? String(error); } catch { return String(error); }
}

/** Turns any failure into a LoginError whose message is safe to display. */
export function classifyLoginError(error: unknown): LoginError {
  if (error instanceof LoginError) return error;
  const text = describe(error);
  let kind: LoginErrorKind = 'unknown';
  // XSTS "XErr" codes returned by Xbox Live.
  if (/2148916233/.test(text)) kind = 'no_xbox_profile';
  else if (/2148916235/.test(text)) kind = 'region_blocked';
  else if (/214891623[67]/.test(text)) kind = 'adult_verification';
  else if (/2148916238/.test(text)) kind = 'child_account';
  else if (/(device[_ ]?code|user[_ ]?code|code).*expired|expired.*code|expired_token/i.test(text)) kind = 'code_expired';
  else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(text)) kind = 'network';
  return new LoginError(kind, FRIENDLY[kind], error);
}

function toDeviceCode(raw: RawDeviceCode): DeviceCodeInfo | null {
  if (!raw.user_code || !raw.verification_uri) return null;
  return {
    userCode: raw.user_code,
    verificationUri: raw.verification_uri,
    ...(raw.verification_uri_complete ? { verificationUriComplete: raw.verification_uri_complete } : {}),
    ...(raw.message ? { message: raw.message } : {})
  };
}

/**
 * Uses the same prismarine-auth settings bedrock-protocol uses by default
 * (Minecraft Nintendo Switch title, live flow), so saved tokens are compatible.
 * prismarine-auth is resolved through bedrock-protocol so no extra dependency is needed.
 */
export function createDefaultAuthflowFactory(): AuthflowFactory {
  return (username, cacheDir, onCode) => {
    let mod: { Authflow: new (u: string, c: string, o: object, cb: (code: RawDeviceCode) => void) => AuthflowLike; Titles: Record<string, string> };
    try {
      const here = createRequire(import.meta.url);
      mod = createRequire(here.resolve('bedrock-protocol'))('prismarine-auth');
    } catch (error) {
      throw new LoginError('unknown', 'Xbox login library (bedrock-protocol) is not installed.', error);
    }
    return new mod.Authflow(username, cacheDir,
      { authTitle: mod.Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo', flow: 'live' }, onCode);
  };
}

function assertSafeCacheDir(dir: string): void {
  const normalized = path.resolve(dir);
  const parsed = path.parse(normalized);
  const depth = normalized.slice(parsed.root.length).split(path.sep).filter(Boolean).length;
  if (!path.isAbsolute(dir) || depth < 2) throw new Error('cacheDir must be an absolute app-private folder');
}

/**
 * Xbox sign-in as its own step, separate from joining a world.
 * signIn() succeeds silently from saved tokens, shows a device code only when needed,
 * and hands back the Authflow that can be passed to bedrock-protocol as `authflow`.
 */
export class XboxLoginService {
  private readonly username: string;
  private readonly cacheDir: string;
  private readonly factory: AuthflowFactory;
  private readonly report: (event: LoginEvent) => void;
  private phase: LoginPhase = 'signed_out';
  private flow: AuthflowLike | null = null;
  private inflight: Promise<AuthflowLike> | null = null;
  private abort: AbortController | null = null;
  private attempt = 0;
  private signOutPending: Promise<void> | null = null;

  constructor(config: XboxLoginConfig, report: (event: LoginEvent) => void = () => {}) {
    if (!config.username.trim()) throw new Error('Xbox username required');
    assertSafeCacheDir(config.cacheDir);
    this.username = config.username;
    this.cacheDir = path.resolve(config.cacheDir);
    this.factory = config.authflowFactory ?? createDefaultAuthflowFactory();
    this.report = report;
  }

  get state(): LoginPhase { return this.phase; }
  /** Only set while signed in. Pass to bedrock-protocol as `authflow`. */
  get authflow(): AuthflowLike | null { return this.flow; }

  private emit(phase: LoginPhase, message: string, extra: { code?: DeviceCodeInfo; errorKind?: LoginErrorKind } = {}): void {
    this.phase = phase;
    this.report({ phase, message, ...extra });
  }

  signIn(options: SignInOptions = {}): Promise<AuthflowLike> {
    if (this.signOutPending) return this.signOutPending.then(() => this.signIn(options));
    if (this.inflight) return this.inflight;
    const run: Promise<AuthflowLike> = this.runSignIn(options).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async runSignIn(options: SignInOptions): Promise<AuthflowLike> {
    const interactive = options.interactive ?? false;
    const attempt = ++this.attempt;
    let active = true;
    const abort = new AbortController();
    this.abort = abort;

    const external = options.signal;
    const onExternalAbort = () => abort.abort();
    if (external) {
      if (external.aborted) abort.abort();
      else external.addEventListener('abort', onExternalAbort, { once: true });
    }

    let rejectGate!: (reason: unknown) => void;
    const gate = new Promise<never>((_, reject) => { rejectGate = reject; });
    gate.catch(() => {});
    const onAbort = () => rejectGate(new LoginError('cancelled', FRIENDLY.cancelled));
    if (abort.signal.aborted) onAbort();
    else abort.signal.addEventListener('abort', onAbort, { once: true });

    try {
      this.emit('signing_in', 'Checking saved Xbox login');
      if (abort.signal.aborted) throw new LoginError('cancelled', FRIENDLY.cancelled);
      await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
      if (abort.signal.aborted) throw new LoginError('cancelled', FRIENDLY.cancelled);
      const onCode = (raw: RawDeviceCode) => {
        if (!active || abort.signal.aborted || attempt !== this.attempt) return;
        if (!interactive) {
          rejectGate(new LoginError('interactive_required', FRIENDLY.interactive_required));
          return;
        }
        const code = toDeviceCode(raw);
        if (!code) {
          rejectGate(new LoginError('unknown', 'Microsoft did not return a sign-in code.'));
          return;
        }
        this.emit('awaiting_code', `Enter ${code.userCode} at ${code.verificationUri}`, { code });
      };
      const flow = this.factory(this.username, this.cacheDir, onCode);
      const token = flow.getXboxToken();
      token.catch(() => {});
      await Promise.race([token, gate]);
      if (abort.signal.aborted || attempt !== this.attempt) throw new LoginError('cancelled', FRIENDLY.cancelled);
      this.flow = flow;
      this.emit('signed_in', 'Signed in to Xbox Live');
      return flow;
    } catch (error) {
      const failure = classifyLoginError(error);
      if (attempt === this.attempt) {
        this.flow = null;
        const quiet = failure.kind === 'cancelled' || failure.kind === 'interactive_required';
        this.emit(quiet ? 'signed_out' : 'failed', failure.message, { errorKind: failure.kind });
      }
      throw failure;
    } finally {
      active = false;
      external?.removeEventListener('abort', onExternalAbort);
      abort.signal.removeEventListener('abort', onAbort);
      if (this.abort === abort) this.abort = null;
    }
  }

  /** Cancels any sign-in in progress, deletes saved tokens, and returns to signed_out. */
  async signOut(): Promise<void> {
    if (this.signOutPending) return this.signOutPending;
    this.attempt++;
    this.abort?.abort();
    this.abort = null;
    this.flow = null;
    const pending = (async () => {
      await rm(this.cacheDir, { recursive: true, force: true });
      this.flow = null;
      this.emit('signed_out', 'Signed out');
    })();
    this.signOutPending = pending;
    try { await pending; } finally { if (this.signOutPending === pending) this.signOutPending = null; }
  }
}
