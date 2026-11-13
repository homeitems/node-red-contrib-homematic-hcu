# node-red-contrib-homematic-hcu

Node-RED nodes for connecting to a Homematic IP Home Control Unit (HCU) through the Homematic IP Connect API. No cloud is required.

The package provides a shared WebSocket connection, device and feature lookup, feature change events, HCU system requests, user-message requests, and Connect API authentication.

> **Development status:** This README describes the current implementation. The package should be tested against the target HCU firmware and Node-RED environment before production use.

## Note on Code Creation

This is a private Node-RED project that I created in my spare time for non-commercial purposes. Parts of this repository were created using AI-powered development tools and were subsequently reviewed, adapted, and further developed by the repository owner.

## Features

- Shared WebSocket connection to the HCU.
- HCU Connect API authentication-token creation and confirmation.
- Support for the Homematic IP HCU WebSocket endpoint on port `9001`.
- Optional support for self-signed TLS certificates.
- Automatic reconnect after unexpected connection loss.
- Automatic answer to `PLUGIN_STATE_REQUEST` messages from the HCU.
- Initial retrieval and caching of the HCU system state.
- Device lookup through the Node-RED editor.
- Reading feature values from the cached system state.
- Event-driven handling of `DEVICE_CHANGED` events.
- Sending generic HCU messages.
- Controlling devices with request/response correlation.
- Creating and deleting HCU user messages.

## Requirements

- Node-RED `4.1.10` or newer (lower versions not tested).
- Node.js `18.0.0` or newer (lower versions not tested).
- A Homematic IP HCU with firmware `1.4.7` or newer, developer mode enabled and the Connect API WebSocket exposed in the local network (both settings are on the developer mode page of HCUweb).
- Network access from the Node-RED host to the HCU (ports `9001` and, for creating a token, `6969`).
- A valid HCU authentication token and the matching plugin ID. Both can be created with the `New HCU connection` node of this package.

The package currently declares the following runtime dependency:

```text
ws ^8.18.0
```

## Installation

### Palette Manager

1. Open the Node-RED menu.
2. Select **Manage palette**.
3. Open the **Install** tab.
4. Search for `node-red-contrib-homematic-hcu`.
5. Install the package.
6. Restart Node-RED if requested.

### npm

From the Node-RED user directory:

```bash
cd ~/.node-red
npm install node-red-contrib-homematic-hcu
```

For local development:

```bash
cd ~/.node-red
npm install --no-save /path/to/node-red-contrib-homematic-hcu
```

After installation, restart Node-RED and deploy the flow again.

## Package nodes

| Node | Purpose | Inputs | Outputs |
|---|---|---:|---:|
| `hcu-config` | Shared HCU WebSocket configuration and connection (configuration node) | — | — |
| `New HCU connection` | Creates and confirms a Connect API authentication token | 1 | 1 |
| `hcu in` | Receives HCU connection events and WebSocket messages | 0 | 1 |
| `hcu out` | Sends a generic message through the shared WebSocket | 1 | 1 |
| `feature event` | Emits a message when a configured device feature is reported | 0 | 1 |
| `get feature value` | Reads a feature from the cached system state | 1 | 1 |
| `set feature value` | Sends a device control request and waits for its response | 1 | 1 |
| `create user message` | Creates a user message on the HCU | 1 | 1 |
| `delete user message` | Deletes a user message on the HCU | 1 | 1 |

## Configuration

Add one `hcu-config` configuration node and use it from the other HCU nodes. In the editor it is shown with its name, its server address or, if both are empty, as `homematic-hcu-config`.

### Server address

Enter only the HCU host name or IP address, for example:

```text
192.168.1.20
hcu1-1234.local
```

`hcu1-XXXX.local` is the default host name of the HCU, where `XXXX` are the last four digits of the SGTIN on the underside of the device.

The WebSocket URL is constructed as:

```text
wss://<serverAddress>:9001
```

Do not enter the protocol or port in the `Server address` field.

### Plugin ID

Enter the plugin identifier used by the HCU Connect API. It must be the same identifier that was used to create the authentication token. It is sent as the `plugin-id` WebSocket header and is included in outgoing HCU messages.

### Auth token

Enter the HCU authentication token. It is stored as a Node-RED credential rather than as a normal flow property.

The connection uses these WebSocket headers:

```http
authtoken: <authToken>
plugin-id: <pluginId>
hmip-system-events: true
```

### Self-signed certificates

The HCU uses a self-signed certificate. Enable **Allow self-signed certificates** to connect without a trusted certificate. This disables TLS certificate verification for the WebSocket connection, so use it only in a controlled local network.

## Connection lifecycle

The configuration node connects automatically when it is created.

After the WebSocket opens, it:

1. Sends a `PLUGIN_STATE_RESPONSE` with `pluginReadinessStatus: READY`.
2. Requests the current system state using `/hmip/home/getSystemState`.
3. Stores the returned system state in a local cache.
4. Broadcasts connection and message events to dependent nodes.

While connected, the node:

- answers every `PLUGIN_STATE_REQUEST` from the HCU with `READY`.
- reports every `ERROR_RESPONSE` from the HCU (sent when the HCU cannot process a message) as an error in the debug sidebar and the Node-RED log, including the error code, the error text and the original message (shortened to 1000 characters). The error is not assigned to a specific request.
- replaces a device in the cache when a `DEVICE_CHANGED` event arrives. Other events (for example `DEVICE_ADDED`, `DEVICE_REMOVED` or `GROUP_CHANGED`) do not update the cache; new or removed devices are reflected after the next reconnect or redeploy.
- mirrors the cache to the global context key `homematicHcu.systemState` (`{ timestamp, data }`), so it can be read in Function nodes.

If the connection closes unexpectedly or cannot be established (including a rejected handshake such as `HTTP 401`), the node retries automatically. The delay starts at 5 seconds and doubles after every failed attempt (5 s, 10 s, 20 s, …) up to 5 minutes. After a successful connection it is reset to 5 seconds. The node status shows the cause and the next attempt, for example `HTTP 401, retry in 20 s`.

The connection is closed without reconnecting when Node-RED deploys or shuts down the node.

## New HCU connection

The `New HCU connection` node generates all data needed for a WebSocket connection to the HCU. This eliminates the need for additional tools or flows. The result can then be entered in the `hcu-config` node.

Any incoming message starts the process. The node sends two HTTPS requests to port `6969` of the HCU (`/hmip/auth/requestConnectApiAuthToken` and `/hmip/auth/confirmConnectApiAuthToken`).

### Configuration

- `Plugin identifier`: Your plugin identifier. Reverse domain notation is recommended, for example `de.doe.jane.plugin.example`.
- `Plugin Name`: JSON language map containing at least a non-empty `de` value. It is shown in HCUweb and in the Homematic IP app.
- `Activation key`: One-time key generated on the developer mode page of HCUweb. It expires after a certain period.
- `Server address`: IPv4 address or host name of the HCU (for example `192.168.1.20` or `hcu1-1234.local`), without protocol or port.
- `Allow self-signed certificate`: Disables TLS certificate verification for these HTTPS requests.

Example plugin name:

```json
{
  "de": "Beispiel-Plugin",
  "en": "Example Plugin"
}
```

> **Note:** After the first Connect API client has been created, the developer mode of the HCU can no longer be deactivated. The client appears in the user overview of the Homematic IP app, where it can be deleted.

### Successful output

The incoming message is forwarded and `msg.payload` is replaced with:

```json
{
  "authToken": "auth-token",
  "clientId": "client-id",
  "serverAddress": "192.168.1.20",
  "pluginIdentifier": "de.example.plugin",
  "requestResponse": {},
  "confirmResponse": {}
}
```

To help troubleshoot an error, the HCU's responses are also output in `requestResponse` and `confirmResponse`.

### Error output

If a request fails, the node reports the error and additionally forwards the message with:

```json
{
  "payload": {
    "error": "error text"
  }
}
```

### Security

The returned `authToken` is sensitive. Do not expose it through Debug nodes, logs, exported flows, or persistent context without appropriate protection.

The activation key is stored as a normal node property and is therefore part of exported flows. Remove it from the node after the token has been created.

## HCU In

`hcu in` receives events from the shared configuration node. It has no input port and one output.

### Configuration

- `Connection`: Required shared HCU configuration.
- `Event filter`: `all` or a specific HCU message type (for example `HMIP_SYSTEM_EVENT`, `HMIP_SYSTEM_RESPONSE`, `ERROR_RESPONSE`, `USER_MESSAGE_ACK_EVENT`).
- `Name`: Optional display name.

With `all`, connection events and all WebSocket messages are forwarded. With a specific event type, only messages whose `payload.type` exactly matches that value are forwarded; connection events are not forwarded.

### Connection events

When the filter is `all`, connection events are emitted as:

```json
{
  "topic": "connection/open",
  "payload": {
    "type": "open"
  }
}
```

```json
{
  "topic": "connection/close",
  "payload": {
    "type": "close",
    "code": 1006,
    "reason": ""
  }
}
```

```json
{
  "topic": "connection/error",
  "payload": {
    "type": "error",
    "error": "error text"
  }
}
```

### WebSocket messages

Incoming HCU messages are forwarded as:

```json
{
  "topic": "HMIP_SYSTEM_EVENT",
  "payload": {
    "type": "HMIP_SYSTEM_EVENT"
  },
  "meta": {
    "isBinary": false,
    "parsedAsJson": true,
    "raw": "{...}"
  },
  "rawEvent": {
    "type": "message"
  }
}
```

For binary WebSocket data, `payload` is represented as a hexadecimal string. Invalid JSON text is forwarded as a string.

## HCU Out

`hcu out` sends `msg.payload` as the `body` of an HCU message.

### Configuration

- `Connection`: Required shared HCU configuration.
- `Message type`: Message type used in the outgoing message, for example `HMIP_SYSTEM_REQUEST` (default), `LIST_USER_MESSAGES_REQUEST` or `SYSTEM_INFO_REQUEST`.
- `Name`: Optional display name.

### Generated message

For this input:

```json
{
  "payload": {
    "path": "/hmip/home/getSystemState",
    "body": {}
  }
}
```

The node creates:

```json
{
  "pluginId": "plugin-id-from-config",
  "id": "generated-uuid",
  "type": "HMIP_SYSTEM_REQUEST",
  "body": {
    "path": "/hmip/home/getSystemState",
    "body": {}
  }
}
```

The fields are set as follows:

- `pluginId`: Value from the selected configuration node.
- `id`: A newly generated UUID for every message.
- `type`: Configured `Message type`.
- `body`: `msg.payload`.

### Output

After successful sending, the input message is forwarded and `msg.payload` is replaced with the generated message. All other message properties are kept.

The node does not wait for a response. Use `hcu in` with the matching filter (for example `HMIP_SYSTEM_RESPONSE`) and compare the `id` to receive it.

## Get Feature Value

`get feature value` reads a feature from the cached HCU system state. It does not listen for new WebSocket events.

### Configuration

- `Connection`: Required shared HCU configuration.
- `Device`: Device selected from the current cached device list.
- `Feature`: Feature name to read, exactly as it appears in the device data (for example `actualTemperature`, `on`, `dimLevel`).
- `Name`: Optional display name.

An incoming message triggers the lookup. The input payload is not used to select the device or feature.

### Device selection

The selected value is always `device.id`, including for devices with:

```text
type: PLUGIN_EXTERNAL
```

For `PLUGIN_EXTERNAL` devices, `pluginDeviceId` is used only as part of the visible editor label.

### Feature lookup

The node searches the entries of `functionalChannels` in order and returns the first match:

1. Direct property on the channel.
2. Property inside `supportedOptionalFeatures` of the channel.

### Output

The input message is forwarded; `msg.payload` and `msg.meta` are replaced:

```json
{
  "payload": {
    "lastStatusUpdate": 1710000000000,
    "label": "Living room",
    "feature": "actualTemperature",
    "value": 21.5
  },
  "meta": {
    "featureSource": "functionalChannels",
    "cacheTimestamp": 1710000000000
  }
}
```

`meta.featureSource` is `functionalChannels` or `supportedOptionalFeatures`, depending on where the feature was found.

No output message is emitted when the cache, the device or the feature is unavailable. The node shows the reason in its status. A missing cache or an empty device list is additionally reported as an error (catchable with a Catch node); a missing device or feature is not.

## Feature Event

`feature event` listens for HCU system events and emits a message whenever a `DEVICE_CHANGED` event for the selected device contains the configured feature.

### Configuration

- `Connection`: Required shared HCU configuration.
- `Device`: Device selected from the current cached device list.
- `Feature`: Feature name to read, exactly as it appears in the device data (for example `actualTemperature`).
- `Name`: Optional display name.

The feature lookup works as described for `get feature value`.

### Output

```json
{
  "payload": {
    "lastStatusUpdate": 1710000000000,
    "label": "Living room",
    "feature": "actualTemperature",
    "value": 21.5
  },
  "feature": "actualTemperature",
  "meta": {
    "featureSource": "functionalChannels"
  }
}
```

A message is emitted for every matching `DEVICE_CHANGED` event, even if the value of the feature itself did not change. Use a Filter (RBE) node to pass only changed values.

No message is emitted when the device or feature does not match.

## Set Feature Value

`set feature value` creates an `HMIP_SYSTEM_REQUEST` for the selected device, sends it through the shared WebSocket, and waits for the matching `HMIP_SYSTEM_RESPONSE`.

### Configuration

- `Connection`: Required shared HCU configuration.
- `Device`: Device selected from the current cached device list.
- `HMIP system request`: Request path selected from the list. All paths of chapter 6.8.1 (`/hmip/device/control/...`) of the Homematic IP Connect API documentation are available.
- `Name`: Optional display name.

### Input payload

`msg.payload` contains the request body for the selected path, as described in chapter 6.8.1 of the Homematic IP Connect API documentation. The node adds `deviceId` automatically. Every device control request also requires `channelIndex`, which must be included in the payload.

Example for the request path `/hmip/device/control/setSwitchState` (switch channel 1 on):

```json
{
  "payload": {
    "on": true,
    "channelIndex": 1
  }
}
```

The channel index can be looked up in `functionalChannels` of the device (for example with `get feature value` or in the global context `homematicHcu.systemState`).

If `msg.payload` is not an object, it is sent as `{ "value": <payload>, "deviceId": "..." }`. An empty payload results in `{ "deviceId": "..." }`.

### Generated request

The following request is generated by the node and sent to the HCU:

```json
{
  "pluginId": "plugin-id",
  "id": "request-id",
  "type": "HMIP_SYSTEM_REQUEST",
  "body": {
    "path": "/hmip/device/control/setSwitchState",
    "body": {
      "on": true,
      "channelIndex": 1,
      "deviceId": "device-id"
    }
  }
}
```

### Output

The node correlates the response using the generated request ID. When the matching `HMIP_SYSTEM_RESPONSE` arrives, the input message is forwarded with `msg.payload` set to the generated request and the response attached as:

```text
msg.payload.response
```

Example of a successful response:

```json
{
  "type": "HMIP_SYSTEM_RESPONSE",
  "id": "request-id",
  "body": {
    "code": 200
  }
}
```

The output is also emitted when the HCU rejects the request. In that case `msg.payload.response.body.code` is not `200` and `msg.payload.response.body.body.errorCode` contains the reason (for example `INVALID_REQUEST`, `UNKNOWN_DEVICE` or `FEATURE_NOT_SUPPORTED`). The node additionally shows a red status with code and error code (for example `400: INVALID_REQUEST`) and reports an error that can be handled with a Catch node.

The timeout is 15 seconds. If no matching response arrives, the node reports an error and emits no output.

The resulting state change is reported separately by the HCU as a `DEVICE_CHANGED` event (see `feature event`).

## Create User Message

`create user message` sends a `CREATE_USER_MESSAGE_REQUEST` to the HCU. The message is then displayed on the home screen of the Homematic IP app.

### Configuration

- `Connection`: Required shared HCU configuration.
- `Message category`: `INFO`, `ERROR`, or `WARN`.
- `Title`: Message title.
- `Message`: Message text.
- `Name`: Optional display name.

The behavior type is always `DISMISSIBLE`: users can dismiss the message in the app, and the plugin is not notified about it. Every message gets a new `userMessageId`.

The title and message are sent as language maps using the same text for German and English:

```json
{
  "de": "Message text",
  "en": "Message text"
}
```

### Runtime overrides

The configured values can be overridden by:

```text
msg.messageCategory
msg.title          (string)
msg.message        (string)
msg.timestamp      (milliseconds since epoch, default: now)
```

### Output

The input message is forwarded and `msg.payload` is replaced with the message sent to the HCU. It contains the `userMessageId`, which is needed to delete the message later.

```json
{
  "pluginId": "plugin-id",
  "id": "generated-id",
  "type": "CREATE_USER_MESSAGE_REQUEST",
  "body": {
    "userMessageId": "generated-uuid",
    "behaviorType": "DISMISSIBLE",
    "messageCategory": "INFO",
    "timestamp": 1710000000000,
    "title": {
      "de": "Title text",
      "en": "Title text"
    },
    "message": {
      "de": "Message text",
      "en": "Message text"
    }
  }
}
```

This node does not wait for a response. Use `hcu in` with the `CREATE_USER_MESSAGE_RESPONSE` filter if confirmation is required.

## Delete User Message

`delete user message` sends a `DELETE_USER_MESSAGE_REQUEST`.

### Input

The user message ID must be provided in `msg.payload`:

```json
{
  "payload": "user-message-id"
}
```

You can take the user message ID from the output of the `create user message` node (`msg.payload.body.userMessageId`).

### Generated request

```json
{
  "id": "msg.id-or-generated-id",
  "type": "DELETE_USER_MESSAGE_REQUEST",
  "pluginId": "plugin-id",
  "body": {
    "userMessageId": "user-message-id"
  }
}
```

The `id` is taken from `msg.id` if present, otherwise it is generated.

The output forwards the input message and replaces `msg.payload` with the generated request object.

This node does not wait for or correlate a delete response. Use `hcu in` with the `DELETE_USER_MESSAGE_RESPONSE` filter if confirmation is required.

## HCU message types

The package sends or receives the following Connect API message types:

```text
HMIP_SYSTEM_REQUEST
HMIP_SYSTEM_RESPONSE
HMIP_SYSTEM_EVENT
PLUGIN_STATE_REQUEST
PLUGIN_STATE_RESPONSE
CREATE_USER_MESSAGE_REQUEST
CREATE_USER_MESSAGE_RESPONSE
DELETE_USER_MESSAGE_REQUEST
DELETE_USER_MESSAGE_RESPONSE
ERROR_RESPONSE
```

All other message types can be sent with `hcu out` and received with `hcu in`.

The exact body schema depends on the selected HCU operation. Consult the official Homematic IP Connect API documentation for the supported API paths and schemas.

## Status and errors

The nodes use Node-RED status indicators to show connection and processing state. Common statuses include:

```text
connecting...
connected
disconnected (<code>)
HTTP <status code>
<cause>, retry in <n> s
not connected
waiting for events
listening
event received
feature matched
value loaded
waiting for response
response received
message sent
request sent
send failed
feature missing
device missing
no cache
connection failed
timeout
```

Common errors include:

```text
WebSocket is not connected
HCU config node not found
No cached HCU system state available
No devices found in cached HCU system state
Timed out waiting for HMIP_SYSTEM_RESPONSE
WebSocket handshake rejected: HTTP <status code>
HCU ERROR_RESPONSE (<code>): <message> - original message: <message>
```

## Security

- Protect the Node-RED editor and runtime.
- Treat HCU authentication tokens and activation keys as secrets.
- Do not place real tokens in README files, screenshots, examples, issue reports, or exported flows.
- Avoid connecting authentication output directly to Debug nodes in production.
- The cached system state is also stored in the global context (`homematicHcu.systemState`). If you use a persistent context store, it is written to disk.
- Enable self-signed certificate support only in a controlled environment.
- Restrict network access to the HCU WebSocket and HTTPS ports.

## Troubleshooting

### The node reports `not connected`

Check:

- HCU IP address or host name.
- Network connectivity from the Node-RED host.
- HCU WebSocket port `9001` and whether the WebSocket is exposed in the developer mode settings.
- `authToken`.
- `pluginId` (must match the plugin identifier used to create the token).
- TLS certificate trust.
- Whether self-signed certificate support is required.

### The node shows `HTTP 401` or `HTTP 403`

The HCU rejected the token or the plugin ID. The node keeps retrying with an increasing delay (up to 5 minutes), but the connection will not succeed until the values are corrected. Check both values and redeploy; the delay starts again at 5 seconds.

### The device list is empty

The editor loads devices from:

```text
/homematic-hcu/<connectionId>/devices
```

Check that:

- the configuration node exists and has been deployed.
- the WebSocket connection is open.
- the initial system state has been received.
- the system state contains a `devices` array or object map.
- the Node-RED editor can access the admin endpoint.

### `get feature value` produces no message

Check:

- the device still exists in the cached state.
- the configured value is exactly `device.id`.
- the feature name matches the HCU data exactly (case-sensitive).
- the feature is located in `functionalChannels` or `supportedOptionalFeatures`.

### `set feature value` times out

Check:

- the WebSocket connection.
- the selected request path.
- whether the HCU returned an `ERROR_RESPONSE` (shown as `HCU ERROR_RESPONSE …` in the debug sidebar, also available with `hcu in` and the filter `ERROR_RESPONSE`).
- whether the HCU returned an `HMIP_SYSTEM_RESPONSE` with the same request ID.

### `set feature value` returns a code other than `200`

Check `msg.payload.response.body.body.errorCode`:

- `INVALID_REQUEST`: a required field is missing, usually `channelIndex`.
- `UNKNOWN_DEVICE` / `UNKNOWN_CHANNEL`: wrong device or channel index.
- `FEATURE_NOT_SUPPORTED`: the selected request path does not fit the device.

## Development

Install dependencies:

```bash
npm install
```

Install the package locally in Node-RED:

```bash
cd ~/.node-red
npm install --no-save /path/to/node-red-contrib-homematic-hcu
```

## Examples

The package currently does not provide importable example flows. Screenshots in the `examples` directory support understanding of node functionality.

## License

MIT License. See the `LICENSE` file for the complete license text.

## Support

I cannot guarantee prompt support, as this is a hobby project. Please use the [GitHub issue tracker](https://github.com/homeitems/node-red-contrib-homematic-hcu/issues) for bug reports and feature requests.
