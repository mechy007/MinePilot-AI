'use strict';
module.exports = Object.freeze({
  VERSION: 'minepilot.runtime.bedrock.v1',
  TARGET_GAME_VERSION: '1.26.66.1',
  CODEC_BASELINE: Object.freeze({ gameVersion: '1.26.60', protocol: 2225 }),
  MAX_PLAN_STEPS: 64,
  MAX_TASK_STEPS: 24,
  MAX_TASK_BUDGET_MS: 120000,
  MAX_OBSERVATION_AGE_MS: 10000
});
