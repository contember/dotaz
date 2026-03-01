import { setTransport } from "../mainview/lib/transport";
import { setStorage } from "../mainview/lib/storage";
import { createInlineTransport } from "../mainview/lib/transport/inline";
import { RpcAppStateStorage } from "../mainview/lib/storage/rpc";
import "../mainview/styles/global.css";
import { render } from "solid-js/web";
import App from "../mainview/App";

setTransport(createInlineTransport());
setStorage(new RpcAppStateStorage());
render(() => <App />, document.getElementById("app")!);
