// Bundles pdf-lib into a single browser ES module (committed to public/vendor).
import { build } from 'esbuild';
await build({
  stdin: { contents: "export * from 'pdf-lib';", resolveDir: process.cwd() },
  bundle: true, format: 'esm', minify: true, target: 'es2020',
  outfile: 'public/vendor/pdf-lib.mjs', legalComments: 'none',
});
console.log('vendor/pdf-lib.mjs built');

// QR code generator (qrcode-generator, MIT) as a browser ES module.
await build({
  stdin: { contents: "import qrcode from 'qrcode-generator'; export default qrcode;", resolveDir: process.cwd() },
  bundle: true, format: 'esm', minify: true, target: 'es2020',
  outfile: 'public/vendor/qrcode.mjs', legalComments: 'none',
});
console.log('vendor/qrcode.mjs built');
