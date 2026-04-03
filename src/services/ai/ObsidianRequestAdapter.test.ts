import { requestUrl } from 'obsidian';
import { sendAIHttpRequest } from './ObsidianRequestAdapter';

describe('ObsidianRequestAdapter', () => {
  it('delegates AI requests to obsidian requestUrl', async () => {
    const response = {
      status: 200,
      json: { ok: true }
    };
    vi.mocked(requestUrl).mockResolvedValue(response as any);

    const result = await sendAIHttpRequest({
      url: 'https://api.example.com/models',
      method: 'GET'
    });

    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://api.example.com/models',
      method: 'GET'
    });
    expect(result).toBe(response);
  });
});
