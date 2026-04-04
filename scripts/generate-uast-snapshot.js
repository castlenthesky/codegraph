"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const UastBuilder_1 = require("../src/graph/cpg/uast/UastBuilder");
const FIXTURES_DIR = path.join(__dirname, '../test/fixtures/code_examples');
const SNAPSHOTS_DIR = path.join(__dirname, '../test/__snapshots__/uast');
const LANGUAGE_MAP = {
    python: { grammar: () => require('tree-sitter-python'), ext: '.py' },
    typescript: { grammar: () => require('tree-sitter-typescript').typescript, ext: '.ts' },
    javascript: { grammar: () => require('tree-sitter-javascript'), ext: '.js' },
};
async function generateSnapshot(language) {
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
    const parser = new tree_sitter_1.default();
    parser.setLanguage(config.grammar());
    const tree = parser.parse(source);
    const parseResult = { tree, changedRanges: null, language };
    const builder = new UastBuilder_1.UastBuilder();
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
        }
        catch (err) {
            console.error(`[${lang}] Error: ${err.message}`);
        }
    }
}
main().catch(console.error);
//# sourceMappingURL=generate-uast-snapshot.js.map