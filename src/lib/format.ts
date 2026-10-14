export const basename = (file: string) => file.split('/').pop() || file;
export const stem = (file: string) => basename(file).replace(/\.[^.]+$/, '');
export const date = (value: string) => new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const duration = (minutes: number | null) => minutes == null ? '사용 한도' : minutes % 1440 === 0 ? `${minutes / 1440}일` : minutes % 60 === 0 ? `${minutes / 60}시간` : `${minutes}분`;
export const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
