import { setTransport } from "../frontend-shared/lib/transport";
import { setStorage } from "../frontend-shared/lib/storage";
import { setCapabilities } from "../frontend-shared/lib/capabilities";
import { createWebSocketTransport } from "./transport";
import { IndexedDbAppStateStorage } from "../frontend-shared/lib/storage/indexeddb";
import "../frontend-shared/styles/global.css";
import { render } from "solid-js/web";
import App from "../frontend-shared/App";

setTransport(createWebSocketTransport());
setStorage(new IndexedDbAppStateStorage());
setCapabilities({ hasFileSystem: false, hasHttpStreaming: true, hasNativeDialogs: false });
render(() => <App />, document.getElementById("app")!);
