// Copyright Dan Dascalescu. All rights reserved. MIT license.

/**
 * Configurable logger outputting to the console and optionally to a file, with cleaned error stack traces, and
 * timestamps in the `YYYY-MM-DD HH:MM:SS[.mmm]` format ([RFC3339, or
 * ISO8601](https://stackoverflow.com/questions/522251/whats-the-difference-between-iso-8601-and-rfc-3339-date-formats/65221179#65221179)).
 *
 * @example Basic usage
 * ```ts
 * import { Logger } from 'jsr:@dandv/timestamp-logger';
 * const logger = new Logger({ filename: 'file.log' });
 *
 * // Timestamped log messages in the YYYY-MM-DDTHH:MM:SS format and the local timezone
 * logger.debug('Greyed out timestamp to de-emphasize');
 * logger.info('Variable number of arguments, not just', 1);
 * logger.warn('Yellow for warnings');
 * logger.error('Error with clean stack trace', new Error('Oops'));
 * await logger.close();
 * ```
 *
 * ## Features
 *
 * + prefixes each line with the local time in RFC3339 `YYYY-MM-DD HH:MM:SS` format (which is ISO8601 with a more
 * readable ` ` between the date and the time instead of the `T`)
 *
 *       [2025-04-23 17:00:00] It's tea time
 *
 * + outputs `Error` objects to file (via [serialize-error](https://www.npmjs.com/package/serialize-error))
 * + cleans up `Error` stack traces (via [clean-stack](https://www.npmjs.com/package/clean-stack))
 * + makes absolute error paths relative to the home directory
 * + uses the native Node `console` with colorization, plus yellow for `WARN`s and red for `ERROR`s
 *   - the downside is that objects beyond 3 levels deep will be displayed as `[Object]`.
 *     Refer to the same timestamp in the log file to see the full JSON dump.
 * + exposes a writable stream
 * + uses four standard log levels: `debug`, `info`, `WARN`, `ERROR`.
 * + option to prefix messages with the same unique id per Logger instance, to distinguish them in parallel processing contexts
 * + you can use the familiar variable-arity `console` format, with arguments of any type:
 *
 *   ```ts ignore
 *   logger.warn('Got', results.length, 'results, but also an error:', results, new Error('oops'));
 *   ```
 *
 * + arrays are logged in JSON format, with newlines for readability
 *
 *   ```ts ignore
 *   logger.error([error1, error2]);  // smart indented display
 *   ```
 *
 *
 * Overall, the package aims to format messages logged to a file as close as possible to the console having been
 * redirected to that file (e.g. by adding newlines for readability), while including more information than what
 * was logged to the console (e.g. by fully dumping objects beyond the first 3 levels of nesting).
 *
 *
 * ## Permissions
 *
 * You may need to run Deno with the following access flags:
 *
 * - [Permission to write to the log file](https://docs.deno.com/runtime/fundamentals/security/#file-system-access)
 * if you initialize the constructor with a filename option (`new Logger({ filename: 'example.log' })`). Run with:
 * ```sh
 * deno run --allow-write example.ts  # or to be strict: --allow-write=example.log
 * ```
 *
 * - [Permission to *determine* (not read) the home directory](https://github.com/denoland/docs/issues/1328) if you
 * log any error objects with `cleanStack: true`. This is required by `clean-stack`. Run with:
 * ```sh
 * deno run --allow-sys=homedir example.ts
 * ```
 *
 *
 * ## Known issues
 *
 * 1. Logging something right before calling `Deno/process.exit()` won't flush the output to the file. This is a
 * problem with all loggers (e.g. [Winston](https://github.com/winstonjs/winston/issues/228),
 * [Bristol](https://github.com/TomFrost/Bristol/issues/55)). As a workaround, try delaying the exit:
 *
 * ```ts ignore
 * setTimeout(() => Deno.exit(1),  1);
 * ```
 *
 * 2. Stack traces don't produce proper URLs. This is an [issue with `clean-stack`](https://github.com/sindresorhus/clean-stack/issues/34).
 *
 * 3. `BigInt` values lose precision when logged to file. This is due to [`JSON.stringify` not supporting BigInt
 * values](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/BigInt_not_serializable).
 *
 * 4. Somewhat ironically, `Date` objects logged to the console will be output in UTC, while in the log file they're
 * output in the local timezone (i.e. passed through `.localISOdt`). This is done to preserve console colorization,
 * and may be improved in a future version. In the meantime, you can pass Date objects to `.localISOdt` if desired.
 *
 * @module
 */
import { createWriteStream, type WriteStream } from 'node:fs';
import cleanStack from 'clean-stack';
import type { Options as CleanStackOptions } from 'clean-stack';  // https://www.npmjs.com/package/clean-stack#options
import { serializeError } from 'serialize-error';
import { Stream } from 'node:stream';

/** Options bag: filename, log level, console output, unique id, format options. */
interface LoggerOptions {
    /** Whether to output to the console. Default `true`. */
    console?: boolean

    /**
     * Optional filename to (also) log to. If passed, it will create a `.stream` instance member, which is an append
     * [writable stream](https://nodejs.org/api/stream.html#stream_writable_streams). You can pass the stream to other
     * libraries.
     *
     * @example [Set up debugging with Mongoose](https://mongoosejs.com/docs/api/mongoose.html#Mongoose.prototype.set())
     * ```ts
     * import mongoose from 'npm:mongoose';
     * const logger = new Logger({ filename: 'file.log' });
     * mongoose.set('debug', logger.stream);
     * // ...
     * await logger.close();
     * ```
     *
     * The file will contain full JSON object dumps, while the console output will only introspect objects 3 levels
     * deep. For readability, error stacks are output with actual newlines in the `stack` property rather than `\n`,
     * thus rendering the JSON technically invalid.
     */
    filename?: string

    /** Whether to include milliseconds at the end of the timestamp. Default `false`. */
    showMillis?: boolean

    /**
     * Whether to use [clean-stack](https://npmjs.com/package/clean-stack) for clean stack traces
     * when logging errors. Default `true`, which passes `{ pretty: true }` to `clean-stack`.
     * You can also set this to an object with [clean-stack options](https://www.npmjs.com/package/clean-stack#options).
     * 
     * Note that `{ pretty: true }` requires permission to determine (not access) your home
     * directory, in order to transform its absolute path into a `~` path in stack trace lines.
     * Under Deno, that will require running with `--allow-sys=homedir`. You can alternatively
     * provide the `basePath` option to `clean-stack`, which won't require this permission.
     */
    cleanStack?: boolean | CleanStackOptions

    /** 
     * Optional identifier to add after the timestamp. Useful for distinguishing output from tasks
     * running in parallel. If a string is passed, it will be output verbatim between square
     * brackets:
     *
     *     [YYYY-MM-DD HH:MM:SS] [your-string] Hello world!
     * 
     * If `true`, a 4-character identifier (Base36 lowercase) will be randomly generated:
     *
     *     [YYYY-MM-DD HH:MM:SS] [d45c] Hello world!
     */
    id?: string | boolean

    /** Whether to use UTC time instead of the local timezone. Default `false`. */
    utcTime?: boolean

    /**
     * Output only messages at this log level or higher. For example, `info` will mute any `.debug(...)` calls,
     * and `warn` will only output `warn` and `error` messages. Default `debug`.
     */ 
    level?: 'debug' | 'info' | 'warn' | 'error'
}

/**
 * Conditional type alias that determines the type of the `Logger.stream` property
 * based on the type of the `filename` option provided during construction.
 *
 * If the generic type parameter `F` (representing the `filename` option's type)
 * extends `string`, this type resolves to `WriteStream`. Otherwise, it resolves
 * to `undefined`.
 *
 * @template F - The type provided for the `filename` option in the {@linkcode Logger} constructor.
 * @internal - Silence the `deno doc --lint` error `public type 'Logger.prototype.stream' references private type 'FilenameConditionalType'`
 */
type FilenameConditionalType<F> = F extends string ? WriteStream : undefined;

/**
 * Log messages to both the console and an optional file, with native console highlight and clean stack Error
 * support. Prefix each line with the current time expressed in the local timezone (or UTC) and ISO8601 format.
 * Optionally include milliseconds, or a random 4-character Base36 identifier.
 */
export class Logger<F> extends Stream.Writable implements Disposable {
    /**
     * If a `filename` was passed to the {@linkcode constructor} then `stream` is an append
     * [writable stream](https://nodejs.org/api/stream.html#stream_writable_streams).
     * Otherwise, `stream` is undefined.
     */
    public stream: FilenameConditionalType<F>;
    static #defaultOptions: LoggerOptions = {
        console: true,
        showMillis: false,
        cleanStack: { pretty: true },
        id: false,
        utcTime: false,
        level: 'debug',
    }
    #options: LoggerOptions;
    static #NEWLINE_REPLACEMENT_TOKEN = 'TIMESTAMP-LOGGER-NEWLINE';
    static #ISO8601RE = new RegExp(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{3})?Z/);
    static #ansiColorReset = '\u001b[39m';
    static #ansiGrey = '\u001b[90m';
    static #ansiYellow = '\u001b[33m';
    static #ansiRed = '\u001b[31m';

    /**
     * Create a new Logger instance.
     * 
     * @param options - Configuration options for the logger: filename to log to, console output,
     *     timestamp format, log level settings etc. See {@linkcode LoggerOptions}.
     *
     * Both the console and the file messages start with the local time in RFC3339 `[YYYY-MM-DD HH:MM:SS]` format,
     * with optional milliseconds. In the log file, messages have an additional prefix indicating the logging level:
     * `debug`, `info`, `WARN` or `ERROR`. `WARN` and `ERROR` prefixes are output to the console as well.
     */
    constructor(options: LoggerOptions & { filename?: F } = {}) {
        super();
        if (options.cleanStack === true)
            delete options.cleanStack;
        if (options.id === true)
            options.id = Math.random().toString(36).slice(2, 6);  // 1_679_616 combinations
        this.#options = { ...Logger.#defaultOptions, ...options };
        if (options.filename) {
            // In the branch that we do have a filename, assign to .stream.
            // We use a type-assertion because TS doesn't automatically realize
            // 'F extends string' in that branch.
            this.stream = createWriteStream(options.filename, { flags: 'a' }) as FilenameConditionalType<F>;
            this.stream!.on('error', (err) => {
              console.error(`Logger file ${this.#options.filename} stream error:`, err);
              // TODO: could disable further file logging, but that would be wrong if the error was transient (e.g. disk full)
            });
        } else {
            if (!this.#options.console)
                throw new Error('Please specify at least `console: true` or a filename to log to.');

            // No filename => .stream is definitely undefined
            this.stream = undefined as FilenameConditionalType<F>;
        }
    }


    /**
     * Convert the most common types of dates to the ISO8601/RFC3339 format, in the local time zone.
     *
     * @param [d = Date.now()] - the date, either a Date object, or a UNIX timestamp in (milli/micro/nano)seconds
     * @return {String} RFC3339 `YYYY-MM-DD HH:MM:SS` string in the local timezone.
     *     ISO8601 would have required 'T' instead of ' ', which is less readable.
     */
    localISOdt(d?: Date | number | string): string {
        if (!d)
            d = new Date();
        // Convert YYYY-MM-DD HH:MM:SS.mmmZ strings to the local timezone
        if (Logger.#ISO8601RE.test(d as string))
            return this.localISOdt(new Date(d));
        if (/^\d{4}-\d\d-\d\d/.test(d as string))
            return d as string;  // leave YYYY-MM-DD strings unchanged
        if (/^\d+\.?\d*$/.test(d as string)) {
            // We have a (possibly fractional) number. Date takes a millisecond argument, so
            if ((d as number) < 4102512345) (d as number) *= 1000;  // ...interpret as seconds if before 1/1/2100
            if (d as number > 4102512345000) (d as number) /= 1000;  // ...and as microseconds if after 1/1/2100
            if (d as number > 4102512345000) (d as number) /= 1000;  // ...and finally as nanoseconds
        }
        if (!(d instanceof Date))
            d = new Date(d as number);  // parse it

        return new Date(d.getTime() - (this.#options.utcTime ? 0 : d.getTimezoneOffset() * 60000))  // the offset is in minutes
            .toISOString().slice(0, this.#options.showMillis ? -1 : -5);  // drop the .milliseconds and/or 'Z';
    }


    /**
     * Stringify an `object` when logging to file while emulating console.* output behavior rather than dumping
     * the result of JSON.stringify directly:
     * - don't quote strings
     * - don't quote undefined
     * - output actual newlines in Error stack traces
     * - include object keys with undefined values
     * - serialize BigInt values
     */
    #messageToJson(potentialObject: unknown, spaces = 4): string {
        // Emulate console.* behavior: don't double-quote undefined
        if (potentialObject === undefined)
            return 'undefined';
        // Emulate console.* behavior: don't double-quote strings
        if (typeof potentialObject === 'string')
            return potentialObject;
        if (potentialObject instanceof Date)
            return this.localISOdt(potentialObject);
        // In case the potentialObject is an Error, call `serializeError`, which will ignore non-errors
        return JSON.stringify(serializeError(potentialObject), (key, value) => {
            // For readability, replace '\n' in Error object stack traces with actual newlines
            if (key === 'stack')
                return value.replaceAll('\n', Logger.#NEWLINE_REPLACEMENT_TOKEN);
            if (value === undefined)
                return 'undefined';
            // For `Date` objects, `value` is the result of calling .toISOString(), not the Date itself
            if (typeof value === 'string' && Logger.#ISO8601RE.test(value))
                return this.localISOdt(value);
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/BigInt_not_serializable
            if (typeof value === 'bigint')
                return Number(value);
            return value;
        }, spaces).replaceAll(Logger.#NEWLINE_REPLACEMENT_TOKEN, '\n');
    }

    /**
     * Called only for file output to format each message as JSON. Removes any ANSI control sequences.
     * 
     * @param messages Array of messages to format as JSON.
     * @returns String of space-separated JSON objects.
     */
    #messagesToJson(messages: unknown[]): string {
        // deno-lint-ignore no-control-regex -- remove ANSI color sequence
        return messages.map(m => this.#messageToJson(m)).join(' ').replace(/\u001b\[\d\w/g, '');
    }
  
    /**
     * Return the timestamp prefix in the local timezone in RFC3339 format (' ' instead of the 'T'), e.g.
     * `[2025-04-20 05:59:00]`
     * 
     * @param [datetime = Date.now()] Optional datetime to format, default now.
     * @returns The formatted timestamp.
     */
    timestamp(datetime?: Date | number | string): string {
        const t = this.localISOdt(datetime);
        return `[${t.replace('T', ' ')}]`;
    }

    /**
     * Look through all messages, identify any object with a `stack` property, and run cleanStack on it.
     * 
     * @param object The object to clean.
     * @returns The cleaned object.
     */
    recursivelyCleanStack(object: unknown): void {
        if (!object || object instanceof Date)
            return;
        if (typeof object === 'object') {
            if ('stack' in object)
                try {
                    object.stack = cleanStack(object.stack as string, this.#options.cleanStack as CleanStackOptions);
                } catch (e: unknown) {
                    // Platform detection: check if Deno and its specific error type exist
                    if (typeof Deno !== 'undefined' && Deno.errors && Deno.errors.NotCapable) {
                        if (e instanceof Deno.errors.NotCapable) {
                            throw new Error('cleanStack with `pretty: true` under Deno requires --allow-sys=homedir; alternatively you can specify basePath');
                        }
                    }
                    // If not a Deno capability error (or not running in Deno), assume it's the read-only issue.
                    // This was once the case for graphql errors in Node.
                    console.warn('Failed to clean stack trace (possibly read-only):', e);
                }
            else
                for (const value of Object.values(object))
                    this.recursivelyCleanStack(value);
        } else if (Array.isArray(object))
            for (const element of object)
                this.recursivelyCleanStack(element);
        else if (object instanceof Set || object instanceof Map)
            for (const value of object.values())
                this.recursivelyCleanStack(value);
    }
  
    /**
     * If the message starts with some newlines, move those *before* the timestamp, because the intent of the caller
     * was to have the newlines before the entire log line, not between the timestamp and their log messages.
     * 
     * @param messages The messages to prepare.
     * @returns The prefix (potential initial newlines, timestamp, and optional id).
     * @internal
     */
    prepareMessages(messages: unknown[]): string {
        // Clean error stack traces for both console and file output.
        if (this.#options.cleanStack)
            this.recursivelyCleanStack(messages);
        let initialNewlines = '';
        if (typeof messages[0] === 'string') {
            initialNewlines = messages[0].match(/^\n+/)?.[0] || '';
            messages[0] = messages[0].slice(initialNewlines.length);
        }
        return initialNewlines + this.timestamp() + (this.#options.id ? ` [${this.#options.id}]` : '');
    }
  
    /**
     * Log in grey color to the console, and with the `debug` prefix to the file.
     * 
     * @param messages The messages to log.
     * @returns `true` if logging to the console, or if the file write buffer is below highWaterMark and more data can
     *     be written immediately, `false` if the write buffer is full and the caller should wait for the 'drain' event.
     */
    debug(...messages: unknown[]): boolean {
        if (this.#options.level !== 'debug')
            return true;
        const prefix = this.prepareMessages(messages);
        // ANSI color codes from https://github.com/Marak/colors.js/blob/master/lib/styles.js
        if (this.#options.console)
            console.debug(`${Logger.#ansiGrey}${prefix}${Logger.#ansiColorReset}`, ...messages);
        return this.stream
          ? this.stream.write(`${prefix} debug: ${this.#messagesToJson(messages)}\n`)
          : true;
    }

    /**
     * Log in normal color to the console (via `console.info`), and with the `info` prefix to the file.
     * 
     * @param messages The messages to log.
     * @returns `true` if logging to the console, or if the file write buffer is below highWaterMark and more data can
     *     be written immediately, `false` if the write buffer is full and the caller should wait for the 'drain' event.
     */
    info(...messages: unknown[]): boolean {
        if (['warn', 'error'].includes(this.#options.level!))
            return true;
        const prefix = this.prepareMessages(messages);
        if (this.#options.console)
            console.info(prefix, ...messages);
        return this.stream
          ? this.stream.write(`${prefix} info: ${this.#messagesToJson(messages)}\n`)
          : true;
    }

    /**
     * Log to the console via `console.warn`, and with the `WARN` prefix to both the console and the file.
     * 
     * @param messages The messages to log.
     * @returns `true` if logging to the console, or if the file write buffer is below highWaterMark and more data can
     *     be written immediately, `false` if the write buffer is full and the caller should wait for the 'drain' event.
     */
    warn(...messages: unknown[]): boolean {
        if (this.#options.level === 'error')
            return true;
        const prefix = this.prepareMessages(messages);
        if (this.#options.console)
            console.warn(`${Logger.#ansiYellow}${prefix}${Logger.#ansiColorReset}`, ...messages);
        return this.stream
          ? this.stream.write(`${prefix} WARN: ${this.#messagesToJson(messages)}\n`)
          : true;
    }

    /**
     * Log to the console via `console.error`, and with the `ERROR` prefix to both the console and the file.
     * 
     * @param messages The messages to log.
     * @returns `true` if logging to the console, or if the file write buffer is below highWaterMark and more data can
     *     be written immediately, `false` if the write buffer is full and the caller should wait for the 'drain' event.
     */
    error(...messages: unknown[]): boolean {
        const prefix = this.prepareMessages(messages);
        if (this.#options.console)
            console.error(`${Logger.#ansiRed}${prefix}${Logger.#ansiColorReset}`, ...messages);
        return this.stream
          ? this.stream.write(`${prefix} ERROR: ${this.#messagesToJson(messages)}\n`)
          : true;
    }

    /**
     * Write to the stream directly, with the `debug` prefix. Also passes the message to `console.debug`,
     * in normal color.
     * 
     * @param message The message to write to the stream.
     * @returns `true` if writing to the console, or if the file write buffer is below highWaterMark and more data can
     *     be written immediately, `false` if the write buffer is full and the caller should wait for the 'drain' event.
     */
    override write(message: unknown): boolean {
        const prefix = this.prepareMessages([message]);
        if (this.#options.console)
            console.debug(prefix, message);
        return this.stream
          ? this.stream.write(`${prefix} debug: ${this.#messageToJson(message)}\n`)
          : true;
    }

    /**
     * Called from `using` or `with`, but caller must wait for the stream to flush before reading from it.
     * @internal - but still shows up in the `deno doc --html` output
     */
    [Symbol.dispose](): void {
        if (this.stream)
            try {
                this.stream.end();
                this.stream.close();
            } finally {
                delete this.stream;
            }
    }

    /**
     * Flush and close the stream asynchronously. Called from `await using` or `with`, and waits for the stream to close.
     *
     * @example Automatically close stream when logger goes out of scope
     * ```ts
     * const filename = 'datetime.log';
     * {
     *     await using logger = new Logger({ filename });
     *     logger.info('');
     * }
     *
     * const output = Deno.readTextFileSync(filename);
     * console.log('First timestamp:', output.slice(1, 20));
     * ```
     *
     * @returns Promise that resolves when the stream has been closed.
     * @internal - but still shows up on JSR
     */
    async [Symbol.asyncDispose](): Promise<void> {
        if (this.stream)
            try {
                // Create a Promise that resolves when the stream emits 'close'
                const closePromise = new Promise<void>((resolve) => {
                    this.stream!.on('close', () => resolve());
                });
                // Trigger flushing
                this.stream.end();
                // Wait for the stream to actually close
                await closePromise;
            } finally {
                delete this.stream;
            }
    }

    /**
     * Close the stream asynchronously.
     *
     * @example Manually close the stream
     * ```ts
     * const filename = 'datetime.log';
     * const logger = new Logger({ filename });
     * logger.info('');
     * await logger.close();
     * const output = Deno.readTextFileSync(filename);
     * console.log('First timestamp:', output.slice(1, 20));
     * ```
     *
     * @returns Promise that resolves when the stream has been closed.
     */
    async close(): Promise<void> {
        await this[Symbol.asyncDispose]();
    }
}
