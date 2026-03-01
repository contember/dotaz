import { setTransport } from "../mainview/lib/transport";
import { setStorage } from "../mainview/lib/storage";
import { createElectrobunTransport } from "../mainview/lib/transport/electrobun";
import { RpcAppStateStorage } from "../mainview/lib/storage/rpc";
import "../mainview/styles/global.css";
import { render } from "solid-js/web";
import App from "../mainview/App";

setTransport(createElectrobunTransport());
setStorage(new RpcAppStateStorage());
render(() => <App />, document.getElementById("app")!);
