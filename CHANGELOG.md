# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ERROR_RESPONSE` messages from the HCU (sent when it cannot process a message) are now reported in the debug sidebar and the Node-RED log, including error code, error text and the original message. Previously they were only visible with an `hcu in` node.

### Fixed

- `set feature value`: if sending the request failed, the 15-second timeout was not cancelled and reported a second error for the same message. The pending request is now removed immediately.
- `set feature value`: responses with a code other than `200` were reported as success. The node now shows a red status with the error code (for example `400: INVALID_REQUEST`) and reports an error that can be handled with a Catch node. The output message is still emitted as before.

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
