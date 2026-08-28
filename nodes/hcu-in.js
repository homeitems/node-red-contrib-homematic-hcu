module.exports = function (RED) {
    /**
     * Input node for receiving events from the shared HCU
     * configuration node.
     *
     * The node subscribes to the config node and forwards incoming
     * connection events and WebSocket messages as regular Node-RED
     * output messages.
     */
    function HcuInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Optional display name of the node
        node.name = config.name || "";

        // Reference to the selected config node
        node.connection = config.connection;

        // Event filter:
        // - "all" forwards all received messages
        // - any other value forwards only messages whose payload.type matches exactly
        node.eventFilter = config.eventFilter || "all";

        // Resolve the referenced config node instance
        node.server = RED.nodes.getNode(node.connection);

        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "missing config node" });
            node.error("HCU config node not found");
            return;
        }

        // Default idle state
        node.status({ fill: "yellow", shape: "ring", text: "waiting for events" });

        // Use the node id as a unique listener id
        node.listenerId = node.id;

        /**
         * Returns true when the incoming payload matches the configured event filter.
         *
         * @param {*} payload
         * @returns {boolean}
         */
        function matchesEventFilter(payload) {
            if (node.eventFilter === "all") {
                return true;
            }

            if (!payload || typeof payload !== "object") {
                return false;
            }

            return payload.type === node.eventFilter;
        }

        /**
         * Handles events received from the config node.
         *
         * @param {object} event
         */
        node.eventHandler = function (event) {
            try {
                if (!event || !event.type) {
                    return;
                }

                // Connection opened
                if (event.type === "open") {
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "connected, waiting for events"
                    });

                    if (node.eventFilter === "all") {
                        node.send({
                            topic: "connection/open",
                            payload: {
                                type: "open"
                            }
                        });
                    }
                    return;
                }

                // Connection closed
                if (event.type === "close") {
                    node.status({
                        fill: "grey",
                        shape: "ring",
                        text: `disconnected (${event.code || "-"})`
                    });

                    if (node.eventFilter === "all") {
                        node.send({
                            topic: "connection/close",
                            payload: event
                        });
                    }
                    return;
                }

                // Connection error
                if (event.type === "error") {
                    node.status({
                        fill: "red",
                        shape: "ring",
                        text: "connection error"
                    });

                    if (node.eventFilter === "all") {
                        node.send({
                            topic: "connection/error",
                            payload: event
                        });
                    }
                    return;
                }

                // Incoming WebSocket message
                if (event.type === "message") {
                    const payload = event.payload;

                    if (!matchesEventFilter(payload)) {
                        return;
                    }

                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "event received"
                    });

                    const msg = {
                        topic:
                            payload && payload.type
                                ? payload.type
                                : "homematic/event",
                        payload: payload,
                        meta: event.meta || {},
                        rawEvent: event
                    };

                    node.send(msg);
                    return;
                }
            } catch (err) {
                node.error(`Error in event handler: ${err.message}`);
            }
        };

        // Register this node as a listener on the shared config node
        node.server.registerListener(node.listenerId, node.eventHandler);

        // If the config node is already connected, reflect that in the status
        if (node.server.connected) {
            node.status({
                fill: "green",
                shape: "dot",
                text: "connected, waiting for events"
            });
        }

        // Clean up listener registration on close
        node.on("close", function (done) {
            if (node.server && node.listenerId) {
                node.server.unregisterListener(node.listenerId);
            }
            done();
        });
    }

    RED.nodes.registerType("hcu-in", HcuInNode);
};