import { setTransport } from "../frontend-shared/lib/transport";
import { setStorage } from "../frontend-shared/lib/storage";
import { createInlineTransport } from "../frontend-shared/lib/transport/inline";
import { RpcAppStateStorage } from "../frontend-shared/lib/storage/rpc";
import "../frontend-shared/styles/global.css";
import { render } from "solid-js/web";
import App from "../frontend-shared/App";

setTransport(createInlineTransport());
setStorage(new RpcAppStateStorage());
render(() => <App />, document.getElementById("app")!);
