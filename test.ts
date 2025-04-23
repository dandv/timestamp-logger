/**
 * @file Test must be run with TZ=America/New_York.
 */
import { Logger } from './mod.ts';
import { assertEquals, assertInstanceOf, assertMatch, assertThrows, assertStringIncludes } from 'jsr:@std/assert';

const filename = 'log.txt';
const referenceDateString = '2010-04-11T05:59:00Z';
const timestampRegex = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
const timestampLength = '[2010-04-11 05:59:00] '.length;

Deno.test('constructor', { permissions: 'none' }, () => {
    let logger = new Logger();
    assertInstanceOf(logger, Logger);
    logger = new Logger({ cleanStack: true });
    // Since `options` is private, we must test for its effects - cleans-stack requiring access to the homedir API
    assertThrows(() => logger.debug(new Error('caught the NotCapable')), 'cleanStack under Deno requires --allow-sys=homedir');
})

Deno.test('timestamp', () => {
    const logger = new Logger({ showMillis: false });
    const prefix = logger.prepareMessages([]);
    assertMatch(prefix, new RegExp('^\\[' + timestampRegex.source + ']$'), 'prefix should be in [YYYY-MM-DD HH-MM-SS] format');
    
    const loggerWithMillis = new Logger({ showMillis: true });
    const prefixWithMillis = loggerWithMillis.prepareMessages([]);
    assertMatch(prefixWithMillis, new RegExp(`^\\[${timestampRegex.source}.\\d{3}]$`), 'prefix should be in [YYYY-MM-DD HH-MM-SS.mmm] format');
});

Deno.test('initial newlines', () => {
    const logger = new Logger({ cleanStack: false });
    let prefix = logger.prepareMessages(['\n\n\nStarting process...']);
    assertMatch(prefix, new RegExp(`^\n\n\n\\[${timestampRegex.source}]$`), 'newlines should stay before timestamp');
    prefix = logger.prepareMessages(['\n`, `\n`, `\nStarting process...']);
    assertMatch(prefix, new RegExp(`^\n\\[${timestampRegex.source}]$`), "Strangely separated newlines? Not supported.");
});

Deno.test('id', () => {
    const logger = new Logger({ id: 'foo' });
    let prefix = logger.prepareMessages(['Hello world!']);
    assertMatch(prefix, new RegExp(`^\\[${timestampRegex.source}] \\[foo]$`), 'id should come after timestamp');
    prefix = logger.prepareMessages(['\n\n\nStarting process...']);
    assertMatch(prefix, new RegExp(`^\n\n\n\\[${timestampRegex.source}] \\[foo]$`), 'newlines should stay before timestamp and id');

    const loggerRandom = new Logger({ id: true });
    prefix = loggerRandom.prepareMessages(['Hello random!']);
    assertMatch(prefix, new RegExp(`^\\[${timestampRegex.source}] \\[[0-9a-z]{4}]$`), 'expected 4-character Base36 id');
});

Deno.test('level', async () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    for (let i = 0; i < levels.length; i++) {
        // deno-lint-ignore no-empty
        try { await Deno.remove(filename); } catch { }
        const logger = new Logger({ level: levels[i], filename, console: false });
        logger.debug('debug');
        logger.info('info');
        logger.warn('warn');
        logger.error('error');
        await logger.close();
        const output = (await Deno.readTextFile(filename)).replace(/\[.+?] (debug|info|WARN|ERROR): /g, '');
        assertEquals(output, levels.slice(i).join('\n') + '\n');
    }
});

Deno.test('clean-stack', { permissions: { sys: false, read: 'inherit', write: 'inherit' } }, async () => {
    function returnError(): Error {
        return new Error('clean me');
    }

    {
        // deno-lint-ignore no-empty
        try { await Deno.remove(filename); } catch { }
        await using logger = new Logger({
            filename,
            cleanStack: { basePath: Deno.cwd() },
        });
        logger.info(returnError());
    }
    let output = await Deno.readTextFile(filename);
    // TODO: this hardcodes the line number but looks much cleaner than a regexp
    assertStringIncludes(output.slice(timestampLength), `info: {
    "name": "Error",
    "message": "clean me",
    "stack": "Error: clean me
    at returnError (test.ts:68:16)
    at test.ts:`, 'direct Error object');  // beyond this we'd have the line:colum, plus https://github.com/sindresorhus/clean-stack/issues/35 

    {
        // deno-lint-ignore no-empty
        try { await Deno.remove(filename); } catch { }
        await using logger = new Logger({
            filename,
            cleanStack: { basePath: Deno.cwd() },
        });
        logger.info({
            err: returnError(),
        });
    }
    output = await Deno.readTextFile(filename);
    assertStringIncludes(output.slice(timestampLength), `info: {
    "err": {
        "name": "Error",
        "message": "clean me",
        "stack": "Error: clean me
    at returnError (test.ts:68:16)
    at test.ts:`, 'nested Error value');  // beyond this we'd have the line:colum, plus https://github.com/sindresorhus/clean-stack/issues/35 
});

Deno.test('array', () => {
    const logger = new Logger();
    const messages = [
        // Real-life GraphQL query
        [
            'Variable "$ID" is not defined.',
            'query ($id: ID!) {\n  discussion(id: $ID) {\n    id\n    topic\n    motivation\n    time\n    imageUrl\n    anchor {\n      id\n      username\n      name\n      __typename\n    }\n    anonymous\n    priorKnowledgeRequired\n    tags\n    instructions\n    questions\n    links {\n      text\n      url\n      __typename\n    }\n    signedUp {\n      signUpTime\n      civilian {\n        name\n        email\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n',
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
        ],
    ];

    const prefix = logger.prepareMessages(messages);
    assertMatch(prefix, new RegExp(`^\\[${timestampRegex.source}]$`), 'prefix should be in YYYY-MM-DD HH-MM-SS format');
});

Deno.test('types', async () => {
    // deno-lint-ignore no-empty
    try { await Deno.remove(filename); } catch { }
    {
        await using logger = new Logger({ filename });
        logger.info({
            false: null,
            true: undefined
        }, BigInt(123), 1, 'foo', true, false, 0, null, undefined, [null, undefined]);
    }
    const output = (await Deno.readTextFile(filename)).slice(timestampLength + ' info:'.length);
    assertEquals(output, `{
    "false": null,
    "true": "undefined"
} 123 1 foo true false 0 null undefined [
    null,
    "undefined"
]
`);
});

Deno.test('dates are logged to file in local time ISO8601', async () => {
    // deno-lint-ignore no-empty
    try { await Deno.remove(filename); } catch { }
    const date = new Date(referenceDateString);
    {
        await using logger = new Logger({ filename, showMillis: false });
        logger.info(referenceDateString, date, { date }, [date], { d: [1, date] });
    }
    const output = (await Deno.readTextFile(filename)).slice(timestampLength + ' info:'.length);
    assertEquals(output, `${referenceDateString} 2010-04-11T01:59:00 {
    "date": "2010-04-11T01:59:00"
} [
    "2010-04-11T01:59:00"
] {
    "d": [
        1,
        "2010-04-11T01:59:00"
    ]
}
`);
});

Deno.test('preserve newlines and escaped newlines in strings', async () => {
    // deno-lint-ignore no-empty
    try { await Deno.remove(filename); } catch { }
    const string = 'String with newline\n. Escaped \\n should be output on one line';
    {
        await using logger = new Logger({ filename });
        logger.info(string);
    }
    const output = (await Deno.readTextFile(filename)).slice(timestampLength + ' info:'.length);
    assertEquals(output, string + '\n');
});

Deno.test('preserve escaped newline in object', async () => {
    // deno-lint-ignore no-empty
    try { await Deno.remove(filename); } catch { }
    const obj = {
        s1: 'Newlines in object values\nshould not break JSON',
        s2: 'Escaped newlines \\n in object values should not break JSON',
    };
    {
        await using logger = new Logger({ filename });
        logger.info(obj);
    }
    const output = (await Deno.readTextFile(filename)).slice(timestampLength + ' info:'.length);
    assertEquals(output, `${JSON.stringify(obj, null, 4)}\n`);
});
