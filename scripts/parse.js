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
exports.parseCST = parseCST;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * A simple script to parse a file or string and output the Tree-sitter CST.
 * Usage:
 *   bun scripts/parse.ts <file_path>
 *   bun scripts/parse.ts "string of code" <language>
 */
// Mapping of file extensions to language names
const EXTENSION_MAP = {
    '.go': 'go',
    '.py': 'python',
    '.java': 'java',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.rs': 'rust',
    '.ts': 'typescript',
    '.tsx': 'tsx',
};
/**
 * Loads a language grammar by name.
 */
function loadLanguage(langName) {
    try {
        switch (langName) {
            case 'go': return require('tree-sitter-go');
            case 'python': return require('tree-sitter-python');
            case 'java': return require('tree-sitter-java');
            case 'javascript': return require('tree-sitter-javascript');
            case 'rust': return require('tree-sitter-rust');
            case 'typescript': return require('tree-sitter-typescript').typescript;
            case 'tsx': return require('tree-sitter-typescript').tsx;
            default:
                throw new Error(`Unsupported or uninstalled language: ${langName}`);
        }
    }
    catch (e) {
        throw new Error(`Failed to load grammar for '${langName}': ${e.message}`);
    }
}
/**
 * Parses source code and returns the CST as a string.
 */
function parseCST(source, langName) {
    const parser = new tree_sitter_1.default();
    const language = loadLanguage(langName);
    parser.setLanguage(language);
    const tree = parser.parse(source);
    return tree.rootNode.toString();
}
// CLI Execution
if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.endsWith('parse.ts'))) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage:');
        console.log('  bun scripts/parse.ts <file_path>');
        console.log('  bun scripts/parse.ts "code string" <language>');
        console.log('\nSupported extensions: ' + Object.keys(EXTENSION_MAP).join(', '));
        process.exit(0);
    }
    const input = args[0];
    let source = '';
    let langName = args[1];
    try {
        if (fs.existsSync(input)) {
            // It's a file
            source = fs.readFileSync(input, 'utf-8');
            if (!langName) {
                const ext = path.extname(input);
                langName = EXTENSION_MAP[ext] || '';
            }
        }
        else {
            // It's a string
            source = input;
        }
        if (!langName) {
            console.error('Error: Language could not be detected. Please provide it as the second argument (e.g., "python", "go").');
            process.exit(1);
        }
        const cst = parseCST(source, langName);
        console.log(cst);
    }
    catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}
//# sourceMappingURL=parse.js.map