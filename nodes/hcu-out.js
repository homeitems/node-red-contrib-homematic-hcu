const crypto = require("crypto");

module.exports = function (RED) {
    /**
     * Output node for sending messages to the shared HCU
     * WebSocket connection.
     */
    function HcuOutNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Optional display name
        node.name = config.name || "";

        // Reference to the shared HCU config node
        node.connection = config.connection;

        // Configured HCU message type
        node.messageType = (
            config.messageType || "HMIP_SYSTEM_REQUEST"
        ).trim();

        // Resolve the config node
        node.server = RED.nodes.getNode(node.connection);

        if (!node.server) {
            node.status({
                fill: "red",
                shape: "ring",
                text: "missing config node"
            });

            node.error("HCU config node not found");
            return;
        }

        node.status({
            fill: "grey",
            shape: "ring",
            text: "ready"
        });

        /**
         * Creates a UUID v4 for the HCU request.
         *
         * @returns {string}
         */
        function createMessageId() {
            return crypto.randomUUID();
        }

        /**
         * Builds the complete HCU message.
         *
         * @param {object} msg
         * @returns {object}
         */
        function buildOutgoingMessage(msg) {
            return {
                pluginId: node.server.pluginId,
                id: createMessageId(),
                type: node.messageType,
                body: msg.payload
            };
        }

        /**
         * Handles incoming Node-RED messages.
         */
        node.on("input", function (msg, send, done) {
            send =
                send ||
                function () {
                    node.send.apply(node, arguments);
                };

            try {
                if (!node.server) {
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

                if (msg.payload === undefined) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "missing payload"
                    });

                    throw new Error("msg.payload is undefined");
                }

                if (!node.server.pluginId) {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "missing plugin-id"
                    });

                    throw new Error(
                        "Plugin ID is missing in the HCU config node"
                    );
                }

                // Build the complete message required by the HCU
                const outgoing = buildOutgoingMessage(msg);

                /*
                 * Send the complete object.
                 * The config node serializes it once with JSON.stringify().
                 */
                node.server.sendMessage(outgoing);

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: "message sent"
                });

                /*
                 * Output the complete HCU object through Node-RED.
                 * The original message properties remain preserved.
                 */
                send({
                    ...msg,
                    payload: outgoing
                });

                if (done) {
                    done();
                }
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

        node.on("close", function (done) {
            done();
        });
    }

    RED.nodes.registerType("hcu-out", HcuOutNode);
};