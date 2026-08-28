const crypto = require("crypto");

module.exports = function (RED) {
    /**
     * Sends HMIP system requests for a configured device through the shared
     * HCU connection and waits for the matching response.
     */
    function SetFeatureValueNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name || "";
        node.connection = config.connection;
        node.device = config.device || "";
        node.hmipSystemRequest =
            (config.hmipSystemRequest || "").trim();

        // Resolve the shared HCU configuration node and track pending requests.
        node.server = RED.nodes.getNode(node.connection);
        node.pendingRequests = new Map();

        if (!node.server) {
            node.status({
                fill: "red",
                shape: "ring",
                text: "missing config node"
            });
            node.error("HCU config node not found");
            return;
        }

        // Generate a UUID, with a cryptographic fallback for older Node.js versions.
        function createRequestId() {
            if (typeof crypto.randomUUID === "function") {
                return crypto.randomUUID();
            }

            return [
                crypto.randomBytes(4).toString("hex"),
                crypto.randomBytes(2).toString("hex"),
                crypto.randomBytes(2).toString("hex"),
                crypto.randomBytes(2).toString("hex"),
                crypto.randomBytes(6).toString("hex")
            ].join("-");
        }

        // Read the plugin ID from the shared configuration node.
        function getPluginIdFromConfig() {
            return node.server && node.server.pluginId
                ? node.server.pluginId
                : "";
        }

        // Build the inner request body and always add the configured device ID.
        function buildInnerBody(payload, deviceId) {
            if (
                payload &&
                typeof payload === "object" &&
                !Array.isArray(payload)
            ) {
                return { ...payload, deviceId: deviceId };
            }

            if (
                payload === undefined ||
                payload === null ||
                payload === ""
            ) {
                return { deviceId: deviceId };
            }

            return { value: payload, deviceId: deviceId };
        }

        // Validate the node configuration and build the HCU request object.
        function buildRequest(msg) {
            const pluginId = getPluginIdFromConfig();

            if (!pluginId) {
                throw new Error(
                    "pluginId could not be resolved from config node"
                );
            }

            if (!node.hmipSystemRequest) {
                throw new Error("HMIP system request is required");
            }

            if (!node.device) {
                throw new Error("Device is required");
            }

            const requestId = createRequestId();
            const requestObject = {
                pluginId: pluginId,
                id: requestId,
                type: "HMIP_SYSTEM_REQUEST",
                body: {
                    path: node.hmipSystemRequest,
                    body: buildInnerBody(msg.payload, node.device)
                }
            };

            return {
                requestId: requestId,
                requestObject: requestObject
            };
        }

        // Process only matching HMIP_SYSTEM_RESPONSE messages.
        function handleConfigNodeEvent(event) {
            if (!event || event.type !== "message") {
                return;
            }

            const response = event.payload;

            if (
                !response ||
                response.type !== "HMIP_SYSTEM_RESPONSE" ||
                !response.id
            ) {
                return;
            }

            const pending = node.pendingRequests.get(response.id);

            if (!pending) {
                return;
            }

            clearTimeout(pending.timeout);
            node.pendingRequests.delete(response.id);

            // Attach the response to the generated request in msg.payload.
            pending.msg.payload.response = response;

            node.status({
                fill: "green",
                shape: "dot",
                text: "response received"
            });

            pending.send(pending.msg);
            pending.done();
        }

        if (typeof node.server.registerListener !== "function") {
            node.status({
                fill: "red",
                shape: "ring",
                text: "listener missing"
            });
            node.error(
                "HCU config node does not support registerListener()"
            );
            return;
        }

        node.server.registerListener(node.id, handleConfigNodeEvent);
        node.status({
            fill: "grey",
            shape: "ring",
            text: "ready"
        });

        // Build, register and send a request for each incoming message.
        node.on("input", function (msg, send, done) {
            send = send || function () {
                node.send.apply(node, arguments);
            };

            try {
                if (!node.server) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "missing config node"
                    });
                    throw new Error(
                        "HCU config node not available"
                    );
                }

                if (!node.server.connected) {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: "not connected"
                    });
                    throw new Error("WebSocket is not connected");
                }

                if (typeof node.server.sendMessage !== "function") {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "send missing"
                    });
                    throw new Error(
                        "Config node does not support sendMessage()"
                    );
                }

                const { requestId, requestObject } = buildRequest(msg);
                msg.payload = requestObject;

                const timeout = setTimeout(function () {
                    const pending = node.pendingRequests.get(requestId);

                    if (!pending) {
                        return;
                    }

                    node.pendingRequests.delete(requestId);
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "timeout"
                    });
                    pending.done(
                        new Error(
                            "Timed out waiting for HMIP_SYSTEM_RESPONSE"
                        )
                    );
                }, 15000);

                // Register before sending so a fast response can be matched.
                node.pendingRequests.set(requestId, {
                    msg: msg,
                    send: send,
                    done: done,
                    timeout: timeout
                });

                node.server.sendMessage(requestObject);

                node.status({
                    fill: "yellow",
                    shape: "dot",
                    text: "waiting for response"
                });
            } catch (err) {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "send failed"
                });
                node.error(err.message, msg);

                if (done) {
                    done(err);
                }
            }
        });

        // Remove the listener and finish all pending requests on shutdown.
        node.on("close", function (done) {
            if (
                node.server &&
                typeof node.server.unregisterListener === "function"
            ) {
                node.server.unregisterListener(node.id);
            }

            for (const [requestId, pending] of node.pendingRequests.entries()) {
                clearTimeout(pending.timeout);

                if (typeof pending.done === "function") {
                    pending.done(
                        new Error(
                            "Node closed before response was received"
                        )
                    );
                }

                node.pendingRequests.delete(requestId);
            }

            if (typeof done === "function") {
                done();
            }
        });
    }

    RED.nodes.registerType("set-feature-value", SetFeatureValueNode);
};
