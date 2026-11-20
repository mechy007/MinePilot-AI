# Bedrock connection validation

The CI workflow only runs `--dry-run` to verify the installed Bedrock SDK can be loaded. **It does not log in or join a world.** A real Xbox device-code flow requires a human and should not put codes/tokens into public GitHub Actions logs.

For an interactive test on a trusted computer with Node.js 24+, clone the repository, run `npm install`, `npm install --no-save --ignore-scripts bedrock-protocol@3.61.0`, and `npm run build`. Then set `MINEPILOT_OWNER_XUID` to the owner's decimal Xbox user ID and `MINEPILOT_BOT_LABEL` to the bot's **separate** Xbox account label. Run `node scripts/validate-bedrock-connection.mjs --live`. Complete Microsoft device login locally, while the owner's Minecraft Bedrock world is open and multiplayer is enabled.

The local runner has a 180-second timeout, handles Ctrl+C, closes the client, and stores credentials in a local app-private cache folder by default. Keep the folder private and out of source control; never upload it. The bot account needs a valid Xbox/Microsoft account and must be allowed to join the owner's world. Do not run the interactive test in GitHub Actions.

Known blockers: `WorldSessionCandidate` currently assumes `hostXuid` metadata that upstream may not expose; therefore owner-world selection can fail closed. Version 1.26.66.1 and Android ARM64 compatibility have not been validated. A PASS indicates a spawn event, not proof of Android same-phone play. Do not paste account passwords, device codes, tokens, or cache contents into issues or chat.
