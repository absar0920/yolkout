// Usage: node --import ./web/js/engine/test/register.mjs <script>
import { register } from "node:module";
register("./sim-loader.mjs", import.meta.url);
