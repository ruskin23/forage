import path from 'node:path';
import fs from 'node:fs';
import { extract } from 'tar';
import { SourceType } from '@shared/enums';

export class StorageService {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    fs.mkdirSync(basePath, { recursive: true });
  }

  getBasePath(): string {
    return this.basePath;
  }

  getSourcePath(externalId: string): string {
    return path.join(this.basePath, externalId);
  }

  async saveSource(externalId: string, buffer: Buffer, sourceType: SourceType): Promise<void> {
    if (sourceType === 'TAR') {
      await this.saveTarball(externalId, buffer);
    } else {
      this.saveSingleFile(externalId, buffer, sourceType);
    }
  }

  private async saveTarball(externalId: string, data: Buffer): Promise<void> {
    const dir = this.getSourcePath(externalId);
    fs.mkdirSync(dir, { recursive: true });

    const tarPath = path.join(dir, 'source.tar.gz');
    fs.writeFileSync(tarPath, data);

    await extract({ file: tarPath, cwd: dir });

    fs.unlinkSync(tarPath);
  }

  private saveSingleFile(externalId: string, data: Buffer, sourceType: SourceType): void {
    const dir = this.getSourcePath(externalId);
    fs.mkdirSync(dir, { recursive: true });

    const filename = sourceType === 'PDF' ? 'source.pdf' : 'source.tex';
    fs.writeFileSync(path.join(dir, filename), data);
  }

  listFiles(externalId: string, subPath?: string): { name: string, type: 'file' | 'dir' }[] {
    const dir = subPath
      ? path.join(this.getSourcePath(externalId), subPath)
      : this.getSourcePath(externalId);

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    return entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' as const : 'file' as const,
    }));
  }

  // Read a file from a paper's source directory
  readFile(externalId: string, filePath: string): string {
    return fs.readFileSync(
      path.join(this.getSourcePath(externalId), filePath),
      'utf-8'
    );
  }

  // Delete source directory after summarization
  deleteSource(externalId: string): void {
    const dir = this.getSourcePath(externalId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }
}
