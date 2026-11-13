module.exports = function (RED) {
    const WebSocket = require("ws");
    const crypto = require("crypto");

    // Reconnect delay: starts at 5 s, doubles after every failed attempt,
    // capped at 5 min, reset after a successful connection.
    const RECONNECT_DELAY_MIN = 5000;
    const RECONNECT_DELAY_MAX = 300000;


    /**
     * Configuration node for a shared WebSocket connection
     * to a HomematicIP HCU instance.
     *
     * Responsibilities:
     * - establish the WebSocket connection
     * - send the required handshake headers
     * - send the READY plugin state response
     * - request the current HMIP system state after connect
     * - cache the returned system state together with a timestamp
     * - forward incoming messages to dependent nodes
     * - reconnect automatically if the connection drops
     * - close the connection cleanly on deploy/shutdown
     */
    function HomematicHcuConnectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;


        // Optional display name of the config node
        node.name = config.name || "";


        // Expected value: host or IP address only, for example 192.168.1.20
        node.serverAddress = (config.serverAddress || "").trim();


        // Plugin identifier used by the HCU
        node.pluginId = (config.pluginId || "").trim();


        // Allow self-signed TLS certificates in controlled local environments
        node.allowSelfSigned =
            config.allowSelfSigned === true || config.allowSelfSigned === "true";


        // Credentials are stored separately by Node-RED
        const credentials = node.credentials || {};
        node.authToken = normalizeAuthToken(credentials.authToken || "");


        // Runtime state
        node.ws = null;
        node.connected = false;
        node.connecting = false;
        node.manualClose = false;
        node.reconnectTimer = null;
        node.reconnectDelay = RECONNECT_DELAY_MIN;

        // Set when the HCU rejects the WebSocket handshake with an HTTP
        // status (e.g. "HTTP 401"); used for status text and to avoid
        // logging the same failure twice.
        node.handshakeError = null;


        // Registered listeners from dependent nodes
        // Key: listener id
        // Value: callback function
        node.listeners = new Map();


        // Cache object for the latest HMIP system state
        // Structure:
        // {
        //   timestamp: <unix timestamp in milliseconds>,
        //   data: <payload.body.body from HMIP_SYSTEM_RESPONSE>
        // }
        node.systemStateCache = null;


        // Stores the request ID of the latest HMIP system state request
        // so the matching HMIP_SYSTEM_RESPONSE can be identified
        node.pendingSystemRequestId = null;


        /**
         * Removes problematic invisible characters from the token.
         * This helps if the token was originally copied from a file.
         *
         * @param {string} value
         * @returns {string}
         */
        function normalizeAuthToken(value) {
            if (typeof value !== "string") {
                return "";
            }


            return value
                .replace(/^\uFEFF/, "")
                .replace(/[\r\n]+$/g, "");
        }


        /**
         * Builds the target WebSocket URL.
         * The target format matches the working reference script:
         * wss://<host>:9001
         *
         * @param {string} host
         * @returns {string}
         */
        function buildWsUrl(host) {
            if (!host) {
                return "";
            }
            return "wss://" + host + ":9001";
        }


        /**
         * Builds the WebSocket connection options.
         *
         * Required headers:
         * - authtoken
         * - plugin-id
         * - hmip-system-events = true
         *
         * The additional hmip-system-events header enables
         * delivery of HMIP system events over this WebSocket connection.
         *
         * @returns {object}
         */
        node.getConnectionOptions = function () {
            const headers = {};


            if (node.authToken) {
                headers["authtoken"] = node.authToken;
            }


            if (node.pluginId) {
                headers["plugin-id"] = node.pluginId;
            }


            headers["hmip-system-events"] = "true";


            const options = { headers };


            if (node.allowSelfSigned) {
                options.rejectUnauthorized = false;
            }


            return options;
        };


        /**
         * Returns the full cached HMIP system state object:
         * {
         *   timestamp: ...,
         *   data: ...
         * }
         *
         * This method is intended for use by other custom nodes.
         *
         * @returns {object|null}
         */
        node.getSystemState = function () {
            return node.systemStateCache;
        };


        /**
         * Returns only the cached HMIP system state payload.
         *
         * @returns {object|null}
         */
        node.getSystemStateData = function () {
            return node.systemStateCache ? node.systemStateCache.data : null;
        };


        /**
         * Returns only the timestamp of the cached HMIP system state.
         *
         * @returns {number|null}
         */
        node.getSystemStateTimestamp = function () {
            return node.systemStateCache ? node.systemStateCache.timestamp : null;
        };


        /**
         * Stores the system state in the local cache and also
         * writes it to global context for use in Function nodes.
         *
         * @param {object} state
         */
        node.setSystemState = function (state) {
            node.systemStateCache = {
                timestamp: Date.now(),
                data: state
            };


            node.context().global.set("homematicHcu.systemState", node.systemStateCache);
        };


        /**
         * Updates cached devices from an HMIP_SYSTEM_EVENT payload.
         *
         * Logic:
         * - only HMIP_SYSTEM_EVENT messages are relevant
         * - body.eventTransaction.events may be an array or an object map
         * - only entries with pushEventType === "DEVICE_CHANGED" are relevant
         * - the cached device with the same device.id is replaced completely
         * - if at least one device was replaced, the cache timestamp is updated
         *   with body.eventTransaction.timestamp when available
         *
         * The global context cache is also synchronized after a successful update.
         *
         * @param {object} payload
         */
        node.updateCachedDevicesFromSystemEvent = function (payload) {
            if (
                !payload ||
                typeof payload !== "object" ||
                payload.type !== "HMIP_SYSTEM_EVENT" ||
                !node.systemStateCache ||
                !node.systemStateCache.data ||
                !node.systemStateCache.data.devices
            ) {
                return;
            }


            const eventTransaction = payload.body && payload.body.eventTransaction;
            const rawEvents = eventTransaction && eventTransaction.events;


            if (!rawEvents || typeof rawEvents !== "object") {
                return;
            }


            const eventList = Array.isArray(rawEvents)
                ? rawEvents
                : Object.values(rawEvents);


            const devices = node.systemStateCache.data.devices;
            let deviceWasUpdated = false;


            function replaceInArray(deviceArray, updatedDevice) {
                const index = deviceArray.findIndex((item) => {
                    return item && typeof item === "object" && item.id === updatedDevice.id;
                });


                if (index === -1) {
                    return false;
                }


                deviceArray[index] = updatedDevice;
                return true;
            }


            function replaceInObject(deviceMap, updatedDevice) {
                for (const key of Object.keys(deviceMap)) {
                    const existing = deviceMap[key];


                    if (
                        existing &&
                        typeof existing === "object" &&
                        existing.id === updatedDevice.id
                    ) {
                        deviceMap[key] = updatedDevice;
                        return true;
                    }
                }


                return false;
            }


            for (const eventItem of eventList) {
                if (
                    !eventItem ||
                    typeof eventItem !== "object" ||
                    eventItem.pushEventType !== "DEVICE_CHANGED" ||
                    !eventItem.device ||
                    typeof eventItem.device !== "object" ||
                    !eventItem.device.id
                ) {
                    continue;
                }


                const updatedDevice = eventItem.device;
                let replaced = false;


                if (Array.isArray(devices)) {
                    replaced = replaceInArray(devices, updatedDevice);
                } else if (typeof devices === "object") {
                    replaced = replaceInObject(devices, updatedDevice);
                }


                if (replaced) {
                    deviceWasUpdated = true;
                }
            }


            if (deviceWasUpdated) {
                if (
                    eventTransaction &&
                    typeof eventTransaction.timestamp === "number"
                ) {
                    node.systemStateCache.timestamp = eventTransaction.timestamp;
                }


                node.context().global.set(
                    "homematicHcu.systemState",
                    node.systemStateCache
                );
            }
        };


        /**
         * Sends the HMIP system state request.
         * The response is expected to contain:
         * - type = HMIP_SYSTEM_RESPONSE
         * - the same request id
         * - body.code = 200
         * - body.body = actual system state object
         */
        node.sendSystemStateRequest = function () {
            const requestId = crypto.randomUUID();
            node.pendingSystemRequestId = requestId;


            const request = {
                pluginId: node.pluginId,
                id: requestId,
                type: "HMIP_SYSTEM_REQUEST",
                body: {
                    path: "/hmip/home/getSystemState",
                    body: {}
                }
            };


            node.sendMessage(request);
        };


        /**
         * Registers a dependent node listener.
         *
         * @param {string} id
         * @param {function} callback
         */
        node.registerListener = function (id, callback) {
            if (!id || typeof callback !== "function") {
                return;
            }


            node.listeners.set(id, callback);
        };


        /**
         * Unregisters a dependent node listener.
         *
         * @param {string} id
         */
        node.unregisterListener = function (id) {
            if (!id) {
                return;
            }


            node.listeners.delete(id);
        };


        /**
         * Broadcasts an event to all registered listeners.
         *
         * Event structure examples:
         * - { type: "open" }
         * - { type: "close", code, reason }
         * - { type: "error", error }
         * - { type: "systemState", payload: node.systemStateCache }
         * - { type: "message", payload, meta }
         *
         * @param {object} event
         */
        node.broadcast = function (event) {
            for (const [listenerId, cb] of node.listeners.entries()) {
                try {
                    cb(event);
                } catch (err) {
                    node.error(`Listener error (${listenerId}): ${err.message}`);
                }
            }
        };


        /**
         * Sends a message through the WebSocket connection.
         * Objects are automatically serialized as JSON.
         *
         * @param {object|string} payload
         */
        node.sendMessage = function (payload) {
            if (!node.ws || node.ws.readyState !== WebSocket.OPEN) {
                throw new Error("WebSocket is not connected");
            }


            const message =
                typeof payload === "string" ? payload : JSON.stringify(payload);


            node.ws.send(message);
        };


        /**
         * Sends the HCU READY message.
         * This tells the HCU that the plugin is ready for operation.
         *
         * @param {string} messageId
         */
        node.sendPluginReady = function (messageId) {
            const response = {
                id: messageId || crypto.randomUUID(),
                pluginId: node.pluginId,
                type: "PLUGIN_STATE_RESPONSE",
                body: {
                    pluginReadinessStatus: "READY"
                }
            };


            node.sendMessage(response);
        };


        /**
         * Reports an ERROR_RESPONSE from the HCU.
         * The HCU sends this message when it could not process a message
         * from the plugin. It is not correlated with a specific request;
         * the error and the original message are written to the log and
         * the debug sidebar so the user can see what was rejected.
         *
         * @param {object} payload ERROR_RESPONSE message
         */
        node.reportErrorResponse = function (payload) {
            const body = payload.body || {};
            const error = body.error || {};
            const code = error.code || "UNKNOWN";
            const message = error.message || "no error message";

            let original = body.originalMessage;

            if (original !== undefined && typeof original !== "string") {
                try {
                    original = JSON.stringify(original);
                } catch (err) {
                    original = String(original);
                }
            }

            if (original === undefined || original === "") {
                original = "not provided";
            } else if (original.length > 1000) {
                original = original.slice(0, 1000) + "… (truncated)";
            }

            node.error(
                `HCU ERROR_RESPONSE (${code}): ${message} - ` +
                `original message: ${original}`
            );
        };


        /**
         * Schedules an automatic reconnect attempt.
         * The delay doubles after every attempt (5 s, 10 s, 20 s, ...)
         * up to 5 minutes and is reset after a successful connection.
         *
         * @returns {number|null} delay in milliseconds, or null if no
         *     reconnect was scheduled
         */
        node.scheduleReconnect = function () {
            if (node.manualClose || node.reconnectTimer) {
                return null;
            }


            const delay = node.reconnectDelay;


            node.reconnectTimer = setTimeout(() => {
                node.reconnectTimer = null;
                node.connect();
            }, delay);


            node.reconnectDelay = Math.min(delay * 2, RECONNECT_DELAY_MAX);


            return delay;
        };


        /**
         * Opens the WebSocket connection to the HCU.
         */
        node.connect = function () {
            if (node.connecting || node.connected) {
                return;
            }


            const url = buildWsUrl(node.serverAddress);


            if (!url) {
                node.status({ fill: "red", shape: "ring", text: "missing server address" });
                return;
            }


            if (!node.pluginId) {
                node.status({ fill: "red", shape: "ring", text: "missing plugin-id" });
                return;
            }


            if (!node.authToken) {
                node.status({ fill: "red", shape: "ring", text: "missing auth token" });
                return;
            }


            node.connecting = true;
            node.manualClose = false;
            node.handshakeError = null;


            node.status({
                fill: "yellow",
                shape: "ring",
                text: node.allowSelfSigned ? "connecting (self-signed)..." : "connecting..."
            });


            try {
                node.ws = new WebSocket(url, node.getConnectionOptions());


                /**
                 * Fired when the WebSocket connection is open.
                 * A READY response is sent immediately after connect.
                 * The HMIP system state request is sent afterwards.
                 */
                node.ws.on("open", () => {
                    node.connecting = false;
                    node.connected = true;
                    node.reconnectDelay = RECONNECT_DELAY_MIN;


                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: node.allowSelfSigned
                            ? "connected (self-signed)"
                            : "connected"
                    });


                    try {
                        node.sendPluginReady(crypto.randomUUID());
                    } catch (err) {
                        node.error(
                            `Failed to send initial PLUGIN_STATE_RESPONSE: ${err.message}`
                        );
                    }


                    try {
                        node.sendSystemStateRequest();
                    } catch (err) {
                        node.error(
                            `Failed to send initial HMIP_SYSTEM_REQUEST: ${err.message}`
                        );
                    }


                    node.broadcast({ type: "open" });
                });


                /**
                 * Fired when the endpoint responds with plain HTTP
                 * instead of switching to a WebSocket connection
                 * (e.g. 401 for an invalid auth token).
                 *
                 * Because this listener exists, ws does not abort the
                 * handshake by itself. The response is drained and the
                 * socket is terminated, which makes ws emit "error" and
                 * "close"; the close handler then schedules a reconnect.
                 */
                const ws = node.ws;

                ws.on("unexpected-response", (req, res) => {
                    node.connecting = false;
                    node.connected = false;


                    const statusCode = res.statusCode;
                    node.handshakeError = `HTTP ${statusCode}`;


                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: node.handshakeError
                    });


                    node.error(`WebSocket handshake rejected: HTTP ${statusCode}`);


                    node.broadcast({
                        type: "error",
                        error: `HTTP ${statusCode} during WebSocket handshake`
                    });


                    // Discard the response body and abort the handshake.
                    res.resume();
                    ws.terminate();
                });


                /**
                 * Fired when a message is received from the HCU.
                 * JSON payloads are parsed automatically.
                 * PLUGIN_STATE_REQUEST is answered automatically.
                 * HMIP_SYSTEM_RESPONSE is checked and cached if it matches
                 * the pending HMIP_SYSTEM_REQUEST and has body.code = 200.
                 * HMIP_SYSTEM_EVENT is used to update changed devices inside the cache.
                 */
                node.ws.on("message", (data, isBinary) => {
                    try {
                        const rawText = isBinary
                            ? data.toString("hex")
                            : data.toString();


                        let payload = rawText;


                        if (!isBinary) {
                            try {
                                payload = JSON.parse(rawText);
                            } catch (e) {
                                payload = rawText;
                            }
                        }


                        if (
                            payload &&
                            typeof payload === "object" &&
                            payload.type === "PLUGIN_STATE_REQUEST"
                        ) {
                            try {
                                node.sendPluginReady(payload.id);
                            } catch (err) {
                                node.error(
                                    `Failed to answer PLUGIN_STATE_REQUEST: ${err.message}`
                                );
                            }
                        }


                        if (
                            payload &&
                            typeof payload === "object" &&
                            payload.type === "HMIP_SYSTEM_RESPONSE" &&
                            payload.id === node.pendingSystemRequestId &&
                            payload.body &&
                            payload.body.code === 200 &&
                            payload.body.body &&
                            typeof payload.body.body === "object"
                        ) {
                            node.setSystemState(payload.body.body);
                            node.pendingSystemRequestId = null;


                            node.broadcast({
                                type: "systemState",
                                payload: node.systemStateCache
                            });
                        }


                        if (
                            payload &&
                            typeof payload === "object" &&
                            payload.type === "HMIP_SYSTEM_EVENT"
                        ) {
                            node.updateCachedDevicesFromSystemEvent(payload);
                        }


                        if (
                            payload &&
                            typeof payload === "object" &&
                            payload.type === "ERROR_RESPONSE"
                        ) {
                            node.reportErrorResponse(payload);
                        }


                        node.broadcast({
                            type: "message",
                            payload: payload,
                            meta: {
                                isBinary: !!isBinary,
                                parsedAsJson: !isBinary && typeof payload === "object",
                                raw: rawText
                            }
                        });
                    } catch (err) {
                        node.error(`Error in WebSocket message handler: ${err.message}`);
                    }
                });


                /**
                 * Fired when a WebSocket error occurs.
                 */
                node.ws.on("error", (err) => {
                    node.connecting = false;
                    node.connected = false;


                    // A rejected handshake was already reported by the
                    // "unexpected-response" handler; the error that ws emits
                    // after terminate() would only duplicate it.
                    if (node.handshakeError) {
                        return;
                    }


                    node.status({ fill: "red", shape: "ring", text: "error" });
                    node.error(`WebSocket error: ${err.message}`);


                    node.broadcast({
                        type: "error",
                        error: err.message
                    });
                });


                /**
                 * Fired when the connection closes.
                 * If the close was not intentional, a reconnect is scheduled.
                 */
                node.ws.on("close", (code, reason) => {
                    node.connecting = false;
                    node.connected = false;
                    node.ws = null;
                    node.pendingSystemRequestId = null;


                    const reasonText = reason ? reason.toString() : "";
                    const cause = node.handshakeError || `disconnected (${code})`;


                    node.status({
                        fill: node.handshakeError ? "red" : "grey",
                        shape: "ring",
                        text: cause
                    });


                    node.broadcast({
                        type: "close",
                        code,
                        reason: reasonText
                    });


                    if (!node.manualClose) {
                        const delay = node.scheduleReconnect();

                        if (delay !== null) {
                            node.status({
                                fill: node.handshakeError ? "red" : "grey",
                                shape: "ring",
                                text: `${cause}, retry in ${Math.round(delay / 1000)} s`
                            });
                        }
                    }
                });
            } catch (err) {
                node.connecting = false;
                node.connected = false;


                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "connection failed"
                });


                node.error(`Failed to create WebSocket connection: ${err.message}`);
                node.scheduleReconnect();
            }
        };


        /**
         * Closes the connection cleanly and prevents automatic reconnect.
         *
         * @param {function} done
         */
        node.disconnect = function (done) {
            node.manualClose = true;


            if (node.reconnectTimer) {
                clearTimeout(node.reconnectTimer);
                node.reconnectTimer = null;
            }


            if (node.ws) {
                try {
                    node.ws.close();
                } catch (err) {
                    node.warn(`Error while closing WebSocket connection: ${err.message}`);
                }
            }


            node.connected = false;
            node.connecting = false;
            node.pendingSystemRequestId = null;
            node.status({});


            if (done) {
                done();
            }
        };


        // Start the connection immediately when the config node is created
        node.connect();


        // Clean up on deploy or shutdown
        node.on("close", function (removed, done) {
            node.listeners.clear();
            node.disconnect(done);
        });
    }


    RED.nodes.registerType("hcu-config", HomematicHcuConnectionNode, {
        credentials: {
            authToken: { type: "password" }
        }
    });


    /**
     * Admin endpoint used by editor dialogs to load devices
     * from the shared config node cache.
     */
    RED.httpAdmin.get("/homematic-hcu/:id/devices", function (req, res) {
        const configNode = RED.nodes.getNode(req.params.id);


        if (!configNode || typeof configNode.getSystemState !== "function") {
            return res.json([]);
        }


        const cache = configNode.getSystemState();


        if (!cache || !cache.data || !cache.data.devices) {
            return res.json([]);
        }


        const devices = cache.data.devices;


        if (Array.isArray(devices)) {
            return res.json(devices);
        }


        if (typeof devices === "object") {
            return res.json(Object.values(devices));
        }


        return res.json([]);
    });
};