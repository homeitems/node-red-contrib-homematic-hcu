const https = require("https");

module.exports = function (RED) {
    /**
     * Creates and confirms a HomematicIP HCU Connect API authentication token.
     *
     * The authentication sequence starts when an input message is received.
     */
    function NewHcuConnectionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Optional display name
        node.name = config.name || "";

        // Plugin configuration
        node.pluginIdentifier = String(config.pluginIdentifier || "").trim();
        node.pluginName = parsePluginName(config.pluginName);
        node.activationKey = String(config.activationKey || "").trim();
        node.serverAddress = String(config.serverAddress || "").trim();

        // Allow self-signed TLS certificates only when explicitly enabled
        node.allowSelfSigned =
            config.allowSelfSigned === true ||
            config.allowSelfSigned === "true";

        // Prevent parallel authentication requests
        node.busy = false;

        node.status({
            fill: "grey",
            shape: "ring",
            text: "ready"
        });

        /**
         * Converts the configured plugin name into an object.
         *
         * The editor stores the value as JSON text. This function also
         * supports an object value for compatibility.
         *
         * @param {*} value
         * @returns {object}
         */
        function parsePluginName(value) {
            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value)
            ) {
                return value;
            }

            if (typeof value !== "string" || !value.trim()) {
                return {};
            }

            try {
                const parsed = JSON.parse(value);

                if (
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed)
                ) {
                    return parsed;
                }

                return {};
            } catch (error) {
                return {};
            }
        }

        /**
         * Formats an API response body for error messages.
         *
         * @param {*} body
         * @returns {string}
         */
        function formatResponseBody(body) {
            if (body === undefined || body === null) {
                return "empty response";
            }

            if (typeof body === "string") {
                return body;
            }

            try {
                return JSON.stringify(body);
            } catch (error) {
                return String(body);
            }
        }

        /**
         * Validates the node configuration.
         */
        function validateConfiguration() {
            const ipv4Pattern =
                /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

            if (!node.pluginIdentifier) {
                throw new Error("Plugin identifier is required");
            }

            if (
                !node.pluginName ||
                typeof node.pluginName !== "object" ||
                Array.isArray(node.pluginName)
            ) {
                throw new Error("Plugin Name must be a valid language map");
            }

            if (
                typeof node.pluginName.de !== "string" ||
                !node.pluginName.de.trim()
            ) {
                throw new Error(
                    "Plugin Name must contain the required key 'de'"
                );
            }

            if (!node.activationKey) {
                throw new Error("Activation key is required");
            }

            if (!ipv4Pattern.test(node.serverAddress)) {
                throw new Error(
                    "Server adress must be a valid IPv4 address"
                );
            }
        }

        /**
         * Sends a POST request to the HCU Connect API.
         *
         * @param {string} path
         * @param {object} body
         * @returns {Promise<object>}
         */
        function post(path, body) {
            return new Promise((resolve, reject) => {
                const requestBody = JSON.stringify(body);

                const requestOptions = {
                    hostname: node.serverAddress,
                    port: 6969,
                    path,
                    method: "POST",
                    headers: {
                        VERSION: "12",
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(requestBody)
                    }
                };

                /**
                 * The HCU may use a self-signed certificate.
                 * Certificate verification is disabled only when the
                 * corresponding editor option is explicitly enabled.
                 */
                if (node.allowSelfSigned) {
                    requestOptions.rejectUnauthorized = false;
                }

                const request = https.request(
                    requestOptions,
                    (response) => {
                        let responseText = "";

                        response.setEncoding("utf8");

                        response.on("data", (chunk) => {
                            responseText += chunk;
                        });

                        response.on("end", () => {
                            let responseBody = responseText;

                            try {
                                responseBody = responseText
                                    ? JSON.parse(responseText)
                                    : null;
                            } catch (error) {
                                // Keep non-JSON responses as plain text.
                            }

                            resolve({
                                statusCode: response.statusCode,
                                headers: response.headers,
                                body: responseBody
                            });
                        });
                    }
                );

                request.setTimeout(15000, () => {
                    request.destroy(
                        new Error("Request timed out")
                    );
                });

                request.on("error", reject);

                request.write(requestBody);
                request.end();
            });
        }

        /**
         * Executes the two-step Connect API authentication sequence.
         *
         * @returns {Promise<object>}
         */
        async function executeAuthentication() {
            validateConfiguration();

            /*
             * Step 1:
             * Request a temporary Connect API authentication token.
             */
            const tokenResponse = await post(
                "/hmip/auth/requestConnectApiAuthToken",
                {
                    activationKey: node.activationKey,
                    pluginId: node.pluginIdentifier,
                    friendlyName: node.pluginName
                }
            );

            if (
                tokenResponse.statusCode < 200 ||
                tokenResponse.statusCode >= 300
            ) {
                throw new Error(
                    "Token request failed with HTTP " +
                    `${tokenResponse.statusCode}: ` +
                    formatResponseBody(tokenResponse.body)
                );
            }

            const authToken =
                tokenResponse.body &&
                tokenResponse.body.authToken;

            if (
                !authToken ||
                typeof authToken !== "string"
            ) {
                throw new Error(
                    "Token response does not contain a valid authToken: " +
                    formatResponseBody(tokenResponse.body)
                );
            }

            /*
             * Step 2:
             * Confirm the temporary authentication token.
             */
            const clientResponse = await post(
                "/hmip/auth/confirmConnectApiAuthToken",
                {
                    activationKey: node.activationKey,
                    authToken
                }
            );

            if (
                clientResponse.statusCode < 200 ||
                clientResponse.statusCode >= 300
            ) {
                throw new Error(
                    "Token confirmation failed with HTTP " +
                    `${clientResponse.statusCode}: ` +
                    formatResponseBody(clientResponse.body)
                );
            }

            const clientId =
                clientResponse.body &&
                clientResponse.body.clientId;

            return {
                authToken,
                clientId,
                serverAddress: node.serverAddress,
                pluginIdentifier: node.pluginIdentifier,
                requestResponse: tokenResponse.body,
                confirmResponse: clientResponse.body
            };
        }

        /**
         * Starts the authentication sequence when an input message arrives.
         */
        node.on("input", async function (msg, send, done) {
            if (node.busy) {
                const error = new Error(
                    "Authentication request is already running"
                );

                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: "request in progress"
                });

                // Report the error once via done(err) (logs it and triggers
                // Catch nodes); node.error() only as fallback.
                if (done) {
                    done(error);
                } else {
                    node.error(error.message, msg);
                }
                return;
            }

            node.busy = true;

            node.status({
                fill: "yellow",
                shape: "ring",
                text: node.allowSelfSigned
                    ? "requesting token (self-signed)"
                    : "requesting token"
            });

            try {
                const result = await executeAuthentication();

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: node.allowSelfSigned
                        ? "connection created (self-signed)"
                        : "connection created"
                });

                send({
                    ...msg,
                    payload: result
                });

                done();
            } catch (error) {
                node.status({
                    fill: "red",
                    shape: "ring",
                    text: "connection failed"
                });

                // The error is forwarded as output message (documented
                // behavior) and reported once via done(err).
                send({
                    ...msg,
                    payload: {
                        error: error.message
                    }
                });

                if (done) {
                    done(error);
                } else {
                    node.error(error.message, msg);
                }
            } finally {
                node.busy = false;
            }
        });
    }

    RED.nodes.registerType(
        "New HCU connection",
        NewHcuConnectionNode
    );
};