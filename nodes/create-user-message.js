module.exports = function (RED) {
    const crypto = require("crypto");

    /**
     * Sends a CreateUserMessageRequest to the HCU.
     *
     * Fixed behavior:
     * - behaviorType is always "DISMISSIBLE"
     * - userMessageId is generated automatically as UUID
     *
     * Configurable fields:
     * - messageCategory
     * - title
     * - message
     *
     * Runtime overrides via msg:
     * - msg.messageCategory
     * - msg.title
     * - msg.message
     * - msg.timestamp
     */
    function CreateUserMessageNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.name = config.name || "";
        node.connection = config.connection;

        node.messageCategory = (config.messageCategory || "INFO").trim();
        node.title = (config.title || "").trim();
        node.message = (config.message || "").trim();

        node.server = RED.nodes.getNode(node.connection);

        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "missing config node" });
            node.error("HCU config node not found");
            return;
        }

        node.status({ fill: "grey", shape: "ring", text: "ready" });

        function resolveValue(msg, key, fallback) {
            if (msg && msg[key] !== undefined && msg[key] !== null && msg[key] !== "") {
                return msg[key];
            }
            return fallback;
        }

        function buildLocalizedMap(value) {
            const text = typeof value === "string" ? value.trim() : "";

            if (!text) {
                return {};
            }

            return {
                de: text,
                en: text
            };
        }

        function buildRequest(msg) {
            const behaviorType = "DISMISSIBLE";
            const userMessageId = crypto.randomUUID();
            const messageCategory = String(
                resolveValue(msg, "messageCategory", node.messageCategory || "INFO")
            ).trim();
            const timestamp = Number(resolveValue(msg, "timestamp", Date.now()));

            const titleValue = resolveValue(msg, "title", node.title);
            const messageValue = resolveValue(msg, "message", node.message);

            const title = buildLocalizedMap(titleValue);
            const message = buildLocalizedMap(messageValue);

            if (!messageCategory) {
                throw new Error("Missing messageCategory");
            }

            if (!title || Object.keys(title).length === 0) {
                throw new Error("Missing title");
            }

            if (!message || Object.keys(message).length === 0) {
                throw new Error("Missing message");
            }

            return {
                pluginId: node.server.pluginId,
                id: RED.util.generateId(),
                type: "CREATE_USER_MESSAGE_REQUEST",
                body: {
                    userMessageId: userMessageId,
                    behaviorType: behaviorType,
                    messageCategory: messageCategory,
                    timestamp: timestamp,
                    title: title,
                    message: message
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

    RED.nodes.registerType("create-user-message", CreateUserMessageNode);
};