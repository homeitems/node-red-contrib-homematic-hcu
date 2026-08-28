module.exports = function (RED) {
    /**
     * Listener node that subscribes to HCU websocket events
     * through the shared config node.
     *
     * The node has no input port. It listens for websocket messages forwarded
     * by the config node and emits an output message only when:
     * 1. the configured device matches a DEVICE_CHANGED event, and
     * 2. the configured feature is found in functionalChannels or
     *    supportedOptionalFeatures.
     */
    function FeatureEventNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Optional node label shown in the editor
        node.name = config.name || "";

        // Reference to the shared HCU config node
        node.connection = config.connection;

        // Selected device id stored by the editor
        node.device = config.device || "";

        // Required feature name configured in the editor
        // The feature is searched in functionalChannels and supportedOptionalFeatures
        node.feature = (config.feature || "").trim();

        // Resolve the referenced config node instance
        node.server = RED.nodes.getNode(node.connection);

        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "missing config" });
            node.error("HCU config node not found");
            return;
        }

        /**
         * Normalizes the event collection to an array.
         * The HCU event payload may contain events as an object map.
         *
         * @param {object|Array} events
         * @returns {Array}
         */
        function getEventList(events) {
            if (!events) {
                return [];
            }

            if (Array.isArray(events)) {
                return events;
            }

            return Object.values(events);
        }

        /**
         * Returns the internal device selection value.
         * The node always uses device.id for matching.
         *
         * @param {object} device
         * @returns {string}
         */
        function getDeviceSelectionValue(device) {
            if (!device || typeof device !== "object") {
                return "";
            }

            return device.id || "";
        }

        /**
         * Searches the configured feature in the device functionalChannels.
         *
         * Search order per channel:
         * 1. direct property on the channel object
         * 2. property inside channel.supportedOptionalFeatures
         *
         * Returns the first matching feature value.
         *
         * @param {object} device
         * @param {string} featureName
         * @returns {{ found: boolean, value: any, source: string|null }}
         */
        function findFeatureValue(device, featureName) {
            if (!device || typeof device !== "object" || !featureName) {
                return { found: false, value: undefined, source: null };
            }

            const functionalChannels = device.functionalChannels;

            if (!functionalChannels || typeof functionalChannels !== "object") {
                return { found: false, value: undefined, source: null };
            }

            for (const channel of Object.values(functionalChannels)) {
                if (!channel || typeof channel !== "object") {
                    continue;
                }

                // First look for the feature directly on the channel object
                if (Object.prototype.hasOwnProperty.call(channel, featureName)) {
                    return {
                        found: true,
                        value: channel[featureName],
                        source: "functionalChannels"
                    };
                }

                // Then look inside supportedOptionalFeatures if present
                if (
                    channel.supportedOptionalFeatures &&
                    typeof channel.supportedOptionalFeatures === "object" &&
                    Object.prototype.hasOwnProperty.call(
                        channel.supportedOptionalFeatures,
                        featureName
                    )
                ) {
                    return {
                        found: true,
                        value: channel.supportedOptionalFeatures[featureName],
                        source: "supportedOptionalFeatures"
                    };
                }
            }

            return { found: false, value: undefined, source: null };
        }

        /**
         * Extracts the matching DEVICE_CHANGED event from an HMIP_SYSTEM_EVENT payload.
         *
         * The node compares device.id for all device types.
         * A result is returned only if the configured feature is found.
         * If the device matches but the feature is missing, a debug status is shown.
         *
         * @param {object} message
         * @returns {object|null}
         */
        function extractChangedDeviceFromSystemEvent(message) {
            if (!message || message.type !== "HMIP_SYSTEM_EVENT") {
                return null;
            }

            const events = getEventList(message?.body?.eventTransaction?.events);

            for (const event of events) {
                if (!event || event.pushEventType !== "DEVICE_CHANGED") {
                    continue;
                }

                const device = event.device;
                if (!device || typeof device !== "object") {
                    continue;
                }

                const compareValue = getDeviceSelectionValue(device);

                if (compareValue !== node.device) {
                    continue;
                }

                const featureResult = findFeatureValue(device, node.feature);

                // Device matched, but the configured feature does not exist
                if (!featureResult.found) {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: "feature missing"
                    });
                    return null;
                }

                return {
                    lastStatusUpdate: device.lastStatusUpdate,
                    label: device.label,
                    feature: node.feature,
                    featureValue: featureResult.value,
                    featureSource: featureResult.source
                };
            }

            return null;
        }

        /**
         * Receives events forwarded by the shared config node.
         *
         * The config node broadcasts wrapper events such as:
         * - open
         * - close
         * - error
         * - systemState
         * - message
         *
         * Only "message" events with a valid HMIP_SYSTEM_EVENT payload
         * are relevant for this node.
         *
         * @param {object} event
         */
        function handleConfigNodeEvent(event) {
            if (!event || event.type !== "message") {
                return;
            }

            const changed = extractChangedDeviceFromSystemEvent(event.payload);

            // Do not emit any message if the device or feature did not match
            if (!changed) {
                return;
            }

            node.status({ fill: "green", shape: "dot", text: "feature matched" });

            node.send({
                payload: {
                    lastStatusUpdate: changed.lastStatusUpdate,
                    label: changed.label,
                    feature: changed.feature,
                    value: changed.featureValue
                },
                feature: node.feature,
                meta: {
                    featureSource: changed.featureSource
                }
            });
        }

        // Ensure the config node supports the listener API
        if (typeof node.server.registerListener !== "function") {
            node.status({ fill: "red", shape: "ring", text: "listener missing" });
            node.error("HCU config node does not support registerListener()");
            return;
        }

        // Register this node as a listener on the shared config node
        node.server.registerListener(node.id, handleConfigNodeEvent);
        node.status({ fill: "yellow", shape: "ring", text: "listening" });

        // Remove the listener when the node is closed or redeployed
        node.on("close", function (removed, done) {
            if (node.server && typeof node.server.unregisterListener === "function") {
                node.server.unregisterListener(node.id);
            }
            done();
        });
    }

    RED.nodes.registerType("feature-event", FeatureEventNode);
};