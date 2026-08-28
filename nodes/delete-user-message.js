module.exports = function (RED) {
    /**
     * Sends a DELETE_USER_MESSAGE_REQUEST to the HCU.
     *
     * Input:
     * - msg.payload: userMessageId
     *
     * Outgoing message structure:
     * {
     *   id: generated-id,
     *   type: "DELETE_USER_MESSAGE_REQUEST",
     *   pluginId: pluginId from config node,
     *   body: {
     *     userMessageId: "..."
     *   }
     * }
     */
    function DeleteUserMessageNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name || "";
        node.connection = config.connection;

        node.server = RED.nodes.getNode(node.connection);

        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "missing config node" });
            node.error("HCU config node not found");
            return;
        }

        node.status({ fill: "grey", shape: "ring", text: "ready" });

        function buildRequest(msg) {
            const userMessageId = msg.payload;

            if (userMessageId === undefined || userMessageId === null || userMessageId === "") {
                throw new Error("msg.payload must contain userMessageId");
            }

            return {
                id: msg.id || RED.util.generateId(),
                type: "DELETE_USER_MESSAGE_REQUEST",
                pluginId: node.server.pluginId,
                body: {
                    userMessageId: String(userMessageId)
                }
            };
        }

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            try {
                if (!node.server) {
                    node.status({ fill: "red", shape: "ring", text: "missing config node" });
                    throw new Error("HCU config node not available");
                }

                if (!node.server.connected) {
                    node.status({ fill: "yellow", shape: "ring", text: "not connected" });
                    throw new Error("WebSocket is not connected");
                }

                const request = buildRequest(msg);

                node.server.sendMessage(request);

                node.status({ fill: "green", shape: "dot", text: "request sent" });

                msg.payload = request;
                send(msg);

                if (done) {
                    done();
                }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "send failed" });
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

    RED.nodes.registerType("delete-user-message", DeleteUserMessageNode);
};