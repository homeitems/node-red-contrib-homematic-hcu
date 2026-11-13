# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `set feature value`: if sending the request failed, the 15-second timeout was not cancelled and reported a second error for the same message. The pending request is now removed immediately.

### Changed

- README aligned with the current implementation and the Homematic IP Connect API documentation (v1.0.1):
  - `set feature value` returns the HCU response in `msg.payload.response` (previously documented as `respond`).
  - The `set feature value` example now includes the required `channelIndex`.
  - `hcu out` always generates a new message ID and replaces `msg.payload` with the sent message.
  - Documented current limitations, the host name `hcu1-XXXX.local`, the global context key `homematicHcu.systemState` and additional troubleshooting steps.
- The published npm package now contains only the files needed at runtime (`nodes/`, `examples/`, README, LICENSE).

## 1.1.4 and earlier

Changes before 1.1.5 were not recorded in this changelog. See the [commit history](https://github.com/homeitems/node-red-contrib-homematic-hcu/commits/main) for details.

[Unreleased]: https://github.com/homeitems/node-red-contrib-homematic-hcu/commits/main
