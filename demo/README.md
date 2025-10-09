# Demo

To run demo scenarios using the bundled demo data, you can pass the demo root to the runner.

Examples:

- npm run demo:run
- node demo/run-demo.js run content-generation --root=demo

If you prefer to use real data, point the server at a different root:

- PO_ROOT=/path/to/real/data node src/ui/server.js
