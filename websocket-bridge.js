// WebSocket Bridge for Flash via ExternalInterface
// This allows Flash to use the browser's native WebSocket API (which supports WSS)

(function () {
    var sockets = {};
    var nextId = 1;

    window.FlashWebSocketBridge = {
        connect: function (url) {
            var id = nextId++;
            var ws = new WebSocket(url);
            sockets[id] = ws;

            ws.onopen = function () {
                if (window.flashWebSocketCallback) {
                    window.flashWebSocketCallback(id, 'open', '');
                }
            };

            ws.onmessage = function (event) {
                if (window.flashWebSocketCallback) {
                    window.flashWebSocketCallback(id, 'message', event.data);
                }
            };

            ws.onerror = function (error) {
                if (window.flashWebSocketCallback) {
                    window.flashWebSocketCallback(id, 'error', 'Connection error');
                }
            };

            ws.onclose = function () {
                if (window.flashWebSocketCallback) {
                    window.flashWebSocketCallback(id, 'close', '');
                }
                delete sockets[id];
            };

            return id;
        },

        send: function (id, message) {
            var ws = sockets[id];
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(message);
                return true;
            }
            return false;
        },

        close: function (id) {
            var ws = sockets[id];
            if (ws) {
                ws.close();
                delete sockets[id];
                return true;
            }
            return false;
        },

        getState: function (id) {
            var ws = sockets[id];
            if (!ws) return -1;
            return ws.readyState;
        }
    };

    console.log('FlashWebSocketBridge initialized');
})();
