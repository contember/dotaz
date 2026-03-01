import { setTransport } from "../frontend-shared/lib/transport";
import { setStorage } from "../frontend-shared/lib/storage";
import { createWebSocketTransport } from "../frontend-shared/lib/transport/websocket";
import { IndexedDbAppStateStorage } from "../frontend-shared/lib/storage/indexeddb";
import "../frontend-shared/styles/global.css";
import { render } from "solid-js/web";
import App from "../frontend-shared/App";

setTransport(createWebSocketTransport());
setStorage(new IndexedDbAppStateStorage());
render(() => <App />, document.getElementById("app")!);
