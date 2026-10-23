#!/usr/bin/env node
// The command was called dai-migrate before the tool was public. Kept so scripts,
// shell history and in-flight migrations keep working; documentation-ai-migrate is the name now.
import { launch } from './launch.mjs';
launch(process.argv.slice(2));
