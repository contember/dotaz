import { setTransport } from "../mainview/lib/transport";
import { setStorage } from "../mainview/lib/storage";
import { createWebSocketTransport } from "../mainview/lib/transport/websocket";
import { IndexedDbAppStateStorage } from "../mainview/lib/storage/indexeddb";
import "../mainview/styles/global.css";
import { render } from "solid-js/web";
import App from "../mainview/App";

setTransport(createWebSocketTransport());
setStorage(new IndexedDbAppStateStorage());
render(() => <App />, document.getElementById("app")!);
