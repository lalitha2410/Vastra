import { useReturnAgent } from './hooks/useReturnAgent';
import { TopBar } from './components/TopBar';
import { ChatPanel } from './components/ChatPanel';
import { OpsDashboard } from './components/OpsDashboard';
import { ApiKeyNotice } from './components/ApiKeyNotice';
import { SplitView } from './components/SplitView';

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

      <SplitView
        accent={brand.colors.primary}
        chat={
          apiKeyMissing ? (
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
          )
        }
        ops={<OpsDashboard brand={brand} tickets={tickets} stats={stats} toolActivity={toolActivity} />}
      />
    </div>
  );
}

export default App;
