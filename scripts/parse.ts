import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A simple script to parse a file or string and output the Tree-sitter CST.
 * Usage:
 *   bun scripts/parse.ts <file_path>
 *   bun scripts/parse.ts "string of code" <language>
 */

// Mapping of file extensions to language names
const EXTENSION_MAP: Record<string, string> = {
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
function loadLanguage(langName: string): any {
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
    } catch (e: any) {
        throw new Error(`Failed to load grammar for '${langName}': ${e.message}`);
    }
}

/**
 * Parses source code and returns the CST as a string.
 */
export function parseCST(source: string, langName: string): string {
    const parser = new Parser();
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
        } else {
            // It's a string
            source = input;
        }

        if (!langName) {
            console.error('Error: Language could not be detected. Please provide it as the second argument (e.g., "python", "go").');
            process.exit(1);
        }

        const cst = parseCST(source, langName);
        console.log(cst);
    } catch (error: any) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}
