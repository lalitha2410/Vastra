import { useReturnAgent } from './hooks/useReturnAgent';
import { TopBar } from './components/TopBar';
import { ChatPanel } from './components/ChatPanel';
import { OpsDashboard } from './components/OpsDashboard';
import { ApiKeyNotice } from './components/ApiKeyNotice';

function App() {
  const {
    brand,
    setBrand,
    messages,
    tickets,
    isTyping,
    toolActivity,
    streamingText,
    apiKeyMissing,
    stats,
    sendMessage,
    reset,
  } = useReturnAgent();

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#f6f7f8]">
      <TopBar brand={brand} onBrandChange={setBrand} onReset={reset} />

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.3fr]">
        <div className="min-h-0 border-r border-[#e2e4e8]">
          {apiKeyMissing ? (
            <ApiKeyNotice />
          ) : (
            <ChatPanel
              brand={brand}
              messages={messages}
              isTyping={isTyping}
              streamingText={streamingText}
              disabled={apiKeyMissing}
              onSend={sendMessage}
            />
          )}
        </div>
        <div className="min-h-0">
          <OpsDashboard brand={brand} tickets={tickets} stats={stats} toolActivity={toolActivity} />
        </div>
      </div>
    </div>
  );
}

export default App;
