// Rendering-only browser regression. MV3 transport is covered by test:browser.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const smoke = await readFile('scripts/browser-smoke.mjs', 'utf8');
let helpers = smoke.slice(0, smoke.indexOf('const fixture = await readFile("test-pages/fixture.html");'));
if (!helpers) throw new Error('Browser regression helper boundary missing.');
helpers = helpers.replace(/import \{ createInterpretationHandler \}[^\n]+\n/, '')
  .replace(/import \{ createMockInterpretationProvider \}[^\n]+\n/, '');
await writeFile('dist/rendering-harness.mjs', helpers + '\nexport {firstExisting,waitForDevToolsPort,waitForJson,CdpClient,evaluate,renderingJourney,renderingTranslations};\n');
const {firstExisting,waitForDevToolsPort,waitForJson,CdpClient,evaluate,renderingJourney,renderingTranslations} =
  await import(pathToFileURL(resolve('dist/rendering-harness.mjs')).href);
await build({stdin:{resolveDir:resolve('.'),loader:'ts',contents:`
  import {PageAnalyzer} from './src/content/analysis/pageAnalyzer';
  import {ReaderController} from './src/content/readerController';
  const scope = window as any;
  const controller = new ReaderController(new PageAnalyzer(), {
    name:'fixture',mode:'unavailable',async translate(requests){return requests.map(request=>({
      regionId:request.regionId,requestKey:request.requestKey,provider:'fixture',
      translatedText:scope._fixtureTranslations[request.text]??(request.text==='Express delivery'
        ?'빠른 배송을 선택하면 상품을 안전하게 포장하여 가능한 한 신속하게 배송해 드립니다.':'[ko] '+request.text)}))},
    async interpret(){throw new Error('Not used by rendering regression')}
  });
  scope._readerListeners=[message=>controller.setEnabled(message.enabled)];
`},bundle:true,format:'iife',platform:'browser',target:'chrome138',outfile:'dist/rendering-driver.js'});
const fixture = await readFile('test-pages/adaptive-rendering.html','utf8');
const driver = await readFile('dist/rendering-driver.js','utf8');
const html = fixture.replace('</html>', () => '<script>window._fixtureTranslations='+JSON.stringify(renderingTranslations)+';'+driver+'</script></html>');
const server = createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const pageUrl='http://127.0.0.1:'+server.address().port+'/';
const profile=await mkdtemp(resolve(tmpdir(),'context-reader-render-only-'));
const chrome=await firstExisting([process.env.CONTEXT_READER_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium']);
const child=spawn(chrome,['--headless=new','--no-first-run','--disable-default-apps','--disable-background-networking','--disable-gpu',
  '--disable-blink-features=TranslationAPI','--window-size=900,700','--user-data-dir='+profile,'--remote-debugging-port=0',pageUrl],{stdio:['ignore','pipe','pipe']});
let browser, page;
try {
  const port=await waitForDevToolsPort(profile,child), endpoint='http://127.0.0.1:'+port;
  browser=new CdpClient(await waitForJson(endpoint+'/json/version',value=>value.webSocketDebuggerUrl,'browser',child));
  const target=await waitForJson(endpoint+'/json/list',values=>values.find(t=>t.type==='page'&&t.url===pageUrl),'fixture',child);
  page=new CdpClient(target.webSocketDebuggerUrl);
  await page.send('DOM.enable');await page.send('Page.enable');
  const setReader=enabled=>evaluate(page,'window._readerListeners.forEach(fn=>fn({type:"SET_READER_ENABLED",enabled:'+enabled+'}))');
  await renderingJourney(page,setReader,pageUrl);
  console.log('Production controller/renderer PASS (deterministic provider; not MV3/provider E2E).');
} finally {
  page?.close();
  if(browser){try{await browser.send('Browser.close')}catch{}browser.close()}else child.kill();
  server.closeAllConnections();await new Promise(resolveClose=>server.close(resolveClose));
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(error=>console.warn('Profile cleanup incomplete: '+error.code));
}
