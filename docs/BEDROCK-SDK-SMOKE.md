# Bedrock SDK install/load smoke

The upstream bedrock-protocol 3.61.0 release is MIT licensed and lists Bedrock 1.26.60 support. It does **not** explicitly list 1.26.66.1. Its package metadata requires Node.js 24+, which is the version used by the current engine and runtime CI workflows.

A separate Node 24 CI workflow installs the exact 3.61.0 version (with install scripts disabled), loads its API and checks the createClient export. It intentionally does not log into Xbox or connect to Minecraft. Native modules, Android ARM64, session metadata, version compatibility, and real same-phone join remain unverified.

Do not treat this smoke test as a successful network or mobile integration. If the dependency install/load fails, inspect its dependency graph and native module requirements before enabling production use.
