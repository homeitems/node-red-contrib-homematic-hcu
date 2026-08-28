module.exports = function (RED) {
    /**
     * Runtime node that reads the cached HCU device list
     * from the shared config node and returns the current value of
     * the configured feature for the selected device.
     *
     * The node expects an input message to trigger the cache lookup.
     * A message is emitted only if:
     * 1. the configured device exists in the cache, and
     * 2. the configured feature is found in functionalChannels or
     *    supportedOptionalFeatures.
     */
    function GetFeatureValueNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Optional node label shown in the editor
        node.name = config.name || "";

        // Reference to the shared HCU config node
        node.connection = config.connection;

        // Selected device id stored by the editor
        node.device = config.device || "";

        // Required feature name configured in the editor
        node.feature = (config.feature || "").trim();

        // Resolve the referenced config node instance
        node.server = RED.nodes.getNode(node.connection);

        if (!node.server) {
            node.status({ fill: "red", shape: "ring", text: "missing config" });
            node.error("HCU config node not found");
            return;
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
         * Converts the cached devices structure into a flat array.
         * The cache may contain devices either as an array or as an object map.
         *
         * @param {object} cache
         * @returns {Array}
         */
        function getDevicesFromCache(cache) {
            if (!cache || !cache.data || !cache.data.devices) {
                return [];
            }

            const devices = cache.data.devices;

            if (Array.isArray(devices)) {
                return devices;
            }

            if (typeof devices === "object") {
                return Object.values(devices);
            }

            return [];
        }

        /**
         * Finds the selected device in the cache.
         *
         * @param {Array} devices
         * @param {string} selectedValue
         * @returns {object|null}
         */
        function findSelectedDevice(devices, selectedValue) {
            for (const device of devices) {
                if (!device || typeof device !== "object") {
                    continue;
                }

                if (getDeviceSelectionValue(device) === selectedValue) {
                    return device;
                }
            }

            return null;
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

                if (Object.prototype.hasOwnProperty.call(channel, featureName)) {
                    return {
                        found: true,
                        value: channel[featureName],
                        source: "functionalChannels"
                    };
                }

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

        node.on("input", function (msg, send, done) {
            try {
                if (typeof node.server.getSystemState !== "function") {
                    node.status({ fill: "red", shape: "ring", text: "cache API missing" });
                    done(new Error("HCU config node does not support getSystemState()"));
                    return;
                }

                const cache = node.server.getSystemState();

                if (!cache || !cache.data) {
                    node.status({ fill: "red", shape: "ring", text: "no cache" });
                    done(new Error("No cached HCU system state available"));
                    return;
                }

                const devices = getDevicesFromCache(cache);

                if (!devices.length) {
                    node.status({ fill: "red", shape: "ring", text: "no devices" });
                    done(new Error("No devices found in cached HCU system state"));
                    return;
                }

                const selectedDevice = findSelectedDevice(devices, node.device);

                if (!selectedDevice) {
                    node.status({ fill: "yellow", shape: "ring", text: "device missing" });
                    done();
                    return;
                }

                const featureResult = findFeatureValue(selectedDevice, node.feature);

                if (!featureResult.found) {
                    node.status({ fill: "yellow", shape: "ring", text: "feature missing" });
                    done();
                    return;
                }

                node.status({ fill: "green", shape: "dot", text: "value loaded" });

                send({
                    ...msg,
                    payload: {
                        lastStatusUpdate: selectedDevice.lastStatusUpdate,
                        label: selectedDevice.label,
                        feature: node.feature,
                        value: featureResult.value
                    },
                    meta: {
                        featureSource: featureResult.source,
                        cacheTimestamp: cache.timestamp
                    }
                });

                done();
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                done(err);
            }
        });
    }

    RED.nodes.registerType("get-feature-value", GetFeatureValueNode);
};