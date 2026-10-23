#!/usr/bin/env node
// Checks Node.js and installs the dependencies on first run, then starts the command line (launch.mjs).
import { launch } from './launch.mjs';
launch(process.argv.slice(2));
