import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { UastBuilder } from '../src/graph/cpg/uast/UastBuilder';

const FIXTURES_DIR = path.join(__dirname, '../test/fixtures/code_examples');
const SNAPSHOTS_DIR = path.join(__dirname, '../test/__snapshots__/uast');

const LANGUAGE_MAP: Record<string, { grammar: () => any; ext: string }> = {
    python: { grammar: () => require('tree-sitter-python'), ext: '.py' },
    typescript: { grammar: () => require('tree-sitter-typescript').typescript, ext: '.ts' },
    javascript: { grammar: () => require('tree-sitter-javascript'), ext: '.js' },
};

async function generateSnapshot(language: string): Promise<void> {
    const config = LANGUAGE_MAP[language];
    if (!config) {
        throw new Error(`Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_MAP).join(', ')}`);
    }

    const langDir = path.join(FIXTURES_DIR, language);
    const files = fs.readdirSync(langDir);
    const fixture = files.find(f => f.startsWith('hello_world.') && f.endsWith(config.ext));

    if (!fixture) {
        throw new Error(`No hello_world${config.ext} fixture found in ${langDir}`);
    }

    const fixturePath = path.join(langDir, fixture);
    const source = fs.readFileSync(fixturePath, 'utf-8');
    const relativeFixturePath = path.relative(path.join(__dirname, '..'), fixturePath);

    const parser = new Parser();
    parser.setLanguage(config.grammar());
    const tree = parser.parse(source);

    const parseResult = { tree, changedRanges: null, language };
    const builder = new UastBuilder();
    const { nodes, edges } = builder.build(parseResult, relativeFixturePath);

    const outDir = path.join(SNAPSHOTS_DIR, language);
    fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, `${language}_hello_world.json`);
    fs.writeFileSync(outPath, JSON.stringify({ nodes, edges }, null, 2));

    console.log(`[${language}] ${nodes.length} nodes, ${edges.length} edges → ${path.relative(path.join(__dirname, '..'), outPath)}`);
}

async function main() {
    const arg = process.argv[2];
    const languages = arg ? [arg] : Object.keys(LANGUAGE_MAP);

    for (const lang of languages) {
        try {
            await generateSnapshot(lang);
        } catch (err: any) {
            console.error(`[${lang}] Error: ${err.message}`);
        }
    }
}

main().catch(console.error);
