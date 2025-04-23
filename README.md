# `timestamp-logger` — Logger with human-readable, clean timestamped output

[![JSR](https://jsr.io/badges/@dandv/timestamp-logger)](https://jsr.io/@dandv/timestamp-logger)

Configurable logger outputting to the console and optionally to a file, with cleaned error stack traces, and timestamps in the `YYYY-MM-DD HH:MM:SS[.mmm]` format ([RFC3339, or ISO8601](https://stackoverflow.com/questions/522251/whats-the-difference-between-iso-8601-and-rfc-3339-date-formats/65221179#65221179)).

![screenshot](https://user-images.githubusercontent.com/33569/92347070-a4884f00-f083-11ea-8bd6-c49a52fe4e50.png)


# Features

+ prefixes each line with the local time in RFC3339 `YYYY-MM-DD HH:MM:SS` format (which is ISO8601 with a more readable ` ` between the date and the time instead of the `T`) 

      [2025-04-23 17:00:00] It's tea time

+ outputs `Error` objects to file (via [serialize-error](https://www.npmjs.com/package/serialize-error))
+ cleans up `Error` stack traces (via [clean-stack](https://www.npmjs.com/package/clean-stack))
+ makes absolute error paths relative to the home directory
+ uses the native Node `console` with colorization, plus yellow for `WARN`s and red for `ERROR`s
  - the downside is that objects beyond 3 levels deep will be displayed as `[Object]`.
    Refer to the same timestamp in the log file to see the full JSON dump.
+ exposes a writable stream
+ uses four standard log levels: `debug`, `info`, `WARN`, `ERROR`.
+ option to prefix messages with the same unique id per Logger instance, to distinguish them in parallel processing contexts
+ you can use the familiar variable-arity `console` format, with arguments of any type:

  ```ts
  logger.warn('Got', results.length, 'results, but also an error:', results, new Error('oops'));
  ```

+ arrays are logged in JSON format, with newlines for readability

  ```ts
  logger.error([error1, error2]);  // smart indented display
  ```


Overall, the package aims to format messages logged to a file as close as possible to the console having been redirected to that file (e.g. by adding newlines for readability), while including more information than what was logged to the console (e.g. by fully dumping objects beyond the first 3 levels of nesting).


# Install

This is a [JSR](https://deno.com/blog/jsr-is-not-another-package-manager) package.

```sh
# Deno (optional if you don't prefix the import with 'jsr:'), current pnpm or yarn
deno add jsr:@dandv/timestamp-logger
pnpm add jsr:@dandv/timestamp-logger
yarn add jsr:@dandv/timestamp-logger

# NPM, bun, and older versions of yarn or pnpm
npx jsr add @dandv/timestamp-logger
bunx jsr add @dandv/timestamp-logger
yarn dlx jsr add @dandv/timestamp-logger
pnpm dlx jsr add @dandv/timestamp-logger
```

# Examples

```ts
import { Logger } from '@dandv/timestamp-logger';
const logger = new Logger({ filename: 'file.log' });

// Timestamped log messages in the YYYY-MM-DDTHH:MM:SS format and the local timezone
logger.debug('Greyed out timestamp to de-emphasize');
logger.info('Variable number of arguments, not just', 1);
logger.warn('Yellow for warnings');
logger.error('Error with clean stack trace', new Error('Oops'));
```

For more examples, see [examples.ts](example.ts).


# Permissions

If you're using Deno, you may need to run Deno with the following access flags:

- [Permission to write to the log file](https://docs.deno.com/runtime/fundamentals/security/#file-system-access) if you initialize the constructor with a filename option (`new Logger({ filename: 'example.log' })`). Run with:
   ```sh
  deno run --allow-write example.ts  # or to be strict: --allow-write=example.log
   ```

- [Permission to *determine* (not read) the home directory](https://github.com/denoland/docs/issues/1328) if you log any error objects with `cleanStack: true`. This is required by `clean-stack`. Run with:
   ```sh
  deno run --allow-sys=homedir example.ts
   ```


# Known issues

1. Logging something right before calling `Deno/process.exit()` won't flush the output to the file. This is a problem with all loggers (e.g. [Winston](https://github.com/winstonjs/winston/issues/228), [Bristol](https://github.com/TomFrost/Bristol/issues/55)). As a workaround, try delaying the exit:

   ```ts
   setTimeout(() => Deno.exit(1),  1);
   ```

2. Stack traces don't produce proper URLs. This is an [issue with `clean-stack`](https://github.com/sindresorhus/clean-stack/issues/34).

3. `BigInt` values lose precision when logged to file. This is due to [`JSON.stringify` not supporting BigInt values](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/BigInt_not_serializable).

4. Somewhat ironically, `Date` objects logged to the console will be output in UTC, while in the log file they're output in the local timezone (i.e. passed through `.localISOdt`). This is done to preserve console colorization, and may be improved in a future version. In the meantime, you can pass Date objects to `.localISOdt` if desired.


# Author

[Dan Dascalescu](https://dandv.me)


# License

MIT
