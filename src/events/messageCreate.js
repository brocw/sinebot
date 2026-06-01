import { parseMessage } from '../utils/messageParser.js';
import { WORDLE_BOT_ID, parseWordleResult } from '../utils/wordleParser.js';
import { recordResult } from '../data/crownStore.js';

export default {
  name: 'messageCreate',
  once: false,
  execute(message) {
    if (message.author.id === WORDLE_BOT_ID) {
      if (message.channelId !== process.env.WORDLE_CHANNEL_ID) return;
      const result = parseWordleResult(message);
      if (result) recordResult(result, message.id);
      return;
    }

    if (message.author.bot) return;

    parseMessage(message);
  },
};
