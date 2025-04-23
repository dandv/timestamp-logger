import { Logger } from './mod.ts';

const loggerToConsoleOnly = new Logger();
// Standard error levels. Messages output with colorization.
loggerToConsoleOnly.debug('Greyed out timestamp to de-emphasize');
loggerToConsoleOnly.info('Variable number of arguments, not just', 1);
loggerToConsoleOnly.warn('Yellow for warnings');
// `clean-stack` requests permission to obtain the home directory
loggerToConsoleOnly.error('Error with clean stack trace', new Error('Oops'));
loggerToConsoleOnly.info(['Arrays are logged', 'as JSON', 'with newlines if necessary']);

// Complex object
const graphqlError = [
    'Variable "$ID" is not defined.',
    'query ($id: ID!) {\n  product(id: $ID) {\n    id\n    name\n    description\n    time\n    imageUrl\n    tags\n    links {\n      text\n      url\n      __typename\n    }\n    __typename\n  }\n}\n',
    null,
    [
        {
            line: 2, column: 18,
        },
        {
            line: 1, column: 1,
        },
    ],
    {},
];

// Long JSON output is easy to read thanks to newlines
loggerToConsoleOnly.debug(graphqlError);

// Logging to file
const loggerToConsoleAndFile = new Logger({ filename: 'test.log' });

loggerToConsoleAndFile.warn('A simple string\non two lines');

// Dates are output in UTC to the console
loggerToConsoleAndFile.info('Be here now', new Date());
loggerToConsoleAndFile.debug({
    foo: 'bar',
    array: [2, new Date()],
});

const error = new Error('Unidentified flying error');
loggerToConsoleAndFile.error([1, true, 'Various types in the same array of messages', error]);

// Roundabout way of obtaining the current time: read the logger timestamp from a file.
// This demonstrates using the `Disposable` interface for automatically closing the stream.
const filename = 'datetime.log';
{
    // deno-lint-ignore no-empty
    try { Deno.removeSync(filename); } catch { }
    await using logger = new Logger({ filename });
    logger.info('');
}

const output = Deno.readTextFileSync(filename);
console.log('Current time:', output.slice(1, 20));
