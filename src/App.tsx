import { useReturnAgent } from './hooks/useReturnAgent';
import { TopBar } from './components/TopBar';
import { ChatPanel } from './components/ChatPanel';
import { CallPanel } from './components/CallPanel';
import { OpsDashboard } from './components/OpsDashboard';
import { ApiKeyNotice } from './components/ApiKeyNotice';
import { SplitView } from './components/SplitView';

function App() {
  const { brand, setBrand, channel, setChannel, tickets, stats, apiKeyMissing, reset, chat, voice } =
    useReturnAgent();

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#f6f7f8]">
      <TopBar brand={brand} channel={channel} onBrandChange={setBrand} onChannelChange={setChannel} onReset={reset} />

      <SplitView
        accent={brand.colors.primary}
        channel={channel}
        left={
          apiKeyMissing ? (
            <ApiKeyNotice />
          ) : channel === 'voice' ? (
            <CallPanel
              brand={brand}
              messages={voice.messages}
              streamingText={voice.streamingText}
              callActive={voice.callActive}
              callSeconds={voice.callSeconds}
              callStatus={voice.callStatus}
              voiceLabel={voice.voiceLabel}
              ttsSupported={voice.ttsSupported}
              apiKeyMissing={apiKeyMissing}
              onSend={voice.sendMessage}
              onStartCall={voice.startCall}
              onEndCall={voice.endCall}
            />
          ) : (
            <ChatPanel
              brand={brand}
              messages={chat.messages}
              isTyping={chat.isTyping}
              streamingText={chat.streamingText}
              disabled={apiKeyMissing}
              onSend={chat.sendMessage}
            />
          )
        }
        ops={
          <OpsDashboard
            brand={brand}
            tickets={tickets}
            stats={stats}
            toolActivity={channel === 'voice' ? voice.toolActivity : chat.toolActivity}
            channel={channel}
            callActive={voice.callActive}
            callSeconds={voice.callSeconds}
            transcript={voice.messages}
          />
        }
      />
    </div>
  );
}

export default App;
