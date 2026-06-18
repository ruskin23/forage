import { downloadSource } from '../sources/arxiv';
import { StorageService } from '../services/Storage';

async function downloadSourceTest() {
  const arxivId = "2602.20430";

  const tempBasePath = "tmp/";
  const storage = new StorageService(tempBasePath);

  const { buffer, sourceType } = await downloadSource(arxivId, null, new AbortController().signal);

  if (buffer && sourceType) {
    await storage.saveSource(arxivId, buffer, sourceType);
    console.log(`Saved ${sourceType} to ${storage.getSourcePath(arxivId)}`);
    console.log('Files:', storage.listFiles(arxivId));
  } else {
    console.log('No source available');
  }
}

downloadSourceTest();
