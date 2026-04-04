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
Object.defineProperty(exports, "__esModule", { value: true });
const fast_xml_parser_1 = require("fast-xml-parser");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const FIXTURES_DIR = path.join(__dirname, '../test/fixtures/code_examples');
const SNAPSHOTS_DIR = path.join(__dirname, '../test/__snapshots__');
const parser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    preserveOrder: true
});
function extractText(sourceLines, startRow, startCol, endRow, endCol) {
    if (startRow === endRow) {
        return sourceLines[startRow]?.substring(startCol, endCol) || "";
    }
    let text = sourceLines[startRow]?.substring(startCol) || "";
    for (let i = startRow + 1; i < endRow; i++) {
        text += "\n" + sourceLines[i];
    }
    text += "\n" + (sourceLines[endRow]?.substring(0, endCol) || "");
    return text;
}
function convertXmlToJson(xmlChildren, sourceLines) {
    const result = [];
    for (const item of xmlChildren) {
        const keys = Object.keys(item);
        // XMLParser with preserveOrder places attributes in ':@' and text in '#text'
        const tagName = keys.find(k => k !== ':@' && k !== '#text');
        if (tagName) {
            const attrs = item[':@'] || {};
            const childrenXml = item[tagName] || [];
            const startRow = parseInt(attrs.srow, 10);
            const startCol = parseInt(attrs.scol, 10);
            const endRow = parseInt(attrs.erow, 10);
            const endCol = parseInt(attrs.ecol, 10);
            const node = {
                type: tagName,
                start: { row: startRow, column: startCol },
                end: { row: endRow, column: endCol },
                children: convertXmlToJson(childrenXml, sourceLines)
            };
            if (attrs.field) {
                node.field = attrs.field;
            }
            // Include full text for terminals (nodes without children) to match tree-sitter typical output context
            if (node.children.length === 0 && !isNaN(startRow)) {
                node.text = extractText(sourceLines, startRow, startCol, endRow, endCol);
            }
            result.push(node);
        }
    }
    return result;
}
async function main() {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
        fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
    const languages = ['python', 'go', 'typescript', 'javascript', 'rust', 'java'];
    for (const lang of languages) {
        const langDir = path.join(FIXTURES_DIR, lang);
        if (!fs.existsSync(langDir))
            continue;
        const files = fs.readdirSync(langDir);
        const helloWorldFile = files.find(f => f.startsWith('hello_world.'));
        if (helloWorldFile) {
            const filePath = path.join(langDir, helloWorldFile);
            console.log(`Processing ${lang}: ${filePath}`);
            // Read source lines for text extraction
            const sourceCode = fs.readFileSync(filePath, 'utf-8');
            const sourceLines = sourceCode.split('\n');
            // Run tree-sitter CLI to fetch XML representation
            const result = (0, child_process_1.spawnSync)('npx', ['-y', 'tree-sitter-cli', 'parse', '-x', filePath], {
                encoding: 'utf-8',
                env: process.env // Inherit PATH 
            });
            if (result.error || result.status !== 0) {
                console.error(`Error parsing ${lang}:`, result.stderr || result.error?.message);
                continue;
            }
            // The XML output might contain non-xml text if there are warnings, so we slice from <?xml
            let xmlOutput = result.stdout;
            const xmlStartIndex = xmlOutput.indexOf('<?xml');
            if (xmlStartIndex > 0) {
                xmlOutput = xmlOutput.substring(xmlStartIndex);
            }
            try {
                const parsedXml = parser.parse(xmlOutput);
                // Roots are Document > sources > source[0] > children
                // parsedXml has length 2 (<?xml?> and <sources>)
                const sourcesNode = parsedXml.find((n) => n.sources);
                if (!sourcesNode)
                    throw new Error("Invalid XML: missing <sources>");
                const sourceNode = sourcesNode.sources.find((n) => n.source);
                if (!sourceNode)
                    throw new Error("Invalid XML: missing <source>");
                // The root AST node is the child inside <source> that is not an attribute/text
                const rootAstXml = sourceNode.source;
                const jsonAst = convertXmlToJson(rootAstXml, sourceLines);
                const snapshotPath = path.join(SNAPSHOTS_DIR, `${lang}_hello_world.json`);
                fs.writeFileSync(snapshotPath, JSON.stringify(jsonAst[0], null, 2));
                console.log(`Saved snapshot to ${snapshotPath}`);
            }
            catch (err) {
                console.error(`Failed to translate XML to JSON for ${lang}:`, err);
            }
        }
    }
}
main().catch(console.error);
//# sourceMappingURL=generate-snapshots.js.map