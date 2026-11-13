# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ERROR_RESPONSE` messages from the HCU (sent when it cannot process a message) are now reported in the debug sidebar and the Node-RED log, including error code, error text and the original message. Previously they were only visible with an `hcu in` node.

### Security

- The admin endpoint `/homematic-hcu/<connectionId>/devices`, which provides the device list for the editor, is now protected with the Node-RED permission `hcu-config.read`. With `adminAuth` enabled, it previously returned the cached device list (names, rooms, states) without login. Logged-in users with `read` or `*` permission are not affected; without `adminAuth` nothing changes.

### Fixed

- `set feature value`: if sending the request failed, the 15-second timeout was not cancelled and reported a second error for the same message. The pending request is now removed immediately.
- `set feature value`: responses with a code other than `200` were reported as success. The node now shows a red status with the error code (for example `400: INVALID_REQUEST`) and reports an error that can be handled with a Catch node. The output message is still emitted as before.
- Connection: after the HCU rejected the WebSocket handshake with an HTTP error (for example `401` for an invalid token), the node never tried to connect again and the request stayed open. The handshake is now aborted and a reconnect is scheduled.
- Errors in `create user message`, `delete user message`, `hcu out`, `set feature value` and `New HCU connection` were logged twice (once by the node and once by Node-RED). Each error is now reported exactly once and can still be handled with a Catch node.
- Connection: deploying while the connection was still being established logged the error "WebSocket was closed before the connection was established". This intended close is no longer reported as an error.

### Changed

- `New HCU connection`: the server address now also accepts host names such as `hcu1-1234.local` (the default host name of the HCU), not only IPv4 addresses. The check in the editor and at runtime is identical; protocol, port or path are rejected.
- Connection: the reconnect delay now increases after every failed attempt (5 s, 10 s, 20 s, … up to 5 minutes) instead of a fixed 5 seconds, and is reset after a successful connection. The node status shows the cause and the next attempt (for example `HTTP 401, retry in 20 s`).
- README aligned with the current implementation and the Homematic IP Connect API documentation (v1.0.1):
  - `set feature value` returns the HCU response in `msg.payload.response` (previously documented as `respond`).
  - The `set feature value` example now includes the required `channelIndex`.
  - `hcu out` always generates a new message ID and replaces `msg.payload` with the sent message.
  - Documented current limitations, the host name `hcu1-XXXX.local`, the global context key `homematicHcu.systemState` and additional troubleshooting steps.
- The published npm package now contains only the files needed at runtime (`nodes/`, `examples/`, README, LICENSE).

## 1.1.4 and earlier

Changes before 1.1.5 were not recorded in this changelog. See the [commit history](https://github.com/homeitems/node-red-contrib-homematic-hcu/commits/main) for details.

[Unreleased]: https://github.com/homeitems/node-red-contrib-homematic-hcu/commits/main
