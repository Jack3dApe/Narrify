import axios from "axios";
import {FormEvent, useEffect, useState} from "react";

function randomIntFromInterval(min:number, max:number) { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function App() {
  const [url, setUrl] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [activeSampleIndex, setActiveSampleIndex] = useState<null|number>(null);
  useEffect(() => {
    if (!samples.length) {
      axios.get('http://localhost:8080/samples')
        .then(response => {
          setSamples(response.data);
        });
    }
  }, []);
  useEffect(() => {
    if (samples.length) {
      randomSample();
      setInterval(() => {
        randomSample();
        console.log('random now');
      }, 3000);
    }
  }, [samples]);
  function randomSample() {
    const random = randomIntFromInterval(0, samples.length - 1)
    console.log(random);
    setActiveSampleIndex(random);
  }
  async function handleSubmit(ev:FormEvent) {
    ev.preventDefault();
    try {
      setLoadingMessage('Generating assets...');
      const assetsResponse = await axios.get(
        'http://localhost:8080/create-story?url='+encodeURIComponent(url)
      );
      const id = assetsResponse.data;
      if (!id || id === 'error') {
        setLoadingMessage('Error generating assets. Check the backend logs.');
        return;
      }
      setLoadingMessage('Preparing your video...');
      const videoResponse = await axios.get('http://localhost:8080/build-video?id='+id);
      if (!videoResponse.data || videoResponse.data === 'error') {
        setLoadingMessage('Error building video. Check the backend logs.');
        return;
      }
      setLoadingMessage('');
      window.location.href = 'http://localhost:8080/'+videoResponse.data;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadingMessage('Error: ' + msg);
    }
  }
  return (
    <>
      {loadingMessage && (
        <div className="fixed inset-0 z-20 bg-black/90 flex flex-col justify-center items-center gap-4">
          <p className="text-4xl text-center px-8">
            {loadingMessage}
          </p>
          {loadingMessage.startsWith('Error') && (
            <button
              onClick={() => setLoadingMessage('')}
              className="mt-4 bg-white text-black px-6 py-2 rounded-full uppercase text-sm">
              Dismiss
            </button>
          )}
        </div>
      )}
      <main className="max-w-2xl mx-auto flex gap-16 px-4">
        <div className="py-8 flex flex-col justify-center">
          <h1 className="text-4xl font-bold uppercase mb-4">
            <span className="text-5xl">
              URL to Video
            </span>
            <br />
            <span className="bg-gradient-to-br from-emerald-300 from-30% to-sky-300 bg-clip-text text-transparent">
              with power of AI
            </span>
          </h1>
          <form
            onSubmit={handleSubmit}
            className="grid gap-2">
            <input
              className="border-2 rounded-full bg-transparent text-white px-4 py-2 grow"
              value={url}
              onChange={ev => setUrl(ev.target.value)}
              type="url" placeholder="https://..."/>
            <button
              className="bg-emerald-500 text-white px-4 py-2 rounded-full uppercase"
              type="submit">
              Create&nbsp;video
            </button>
          </form>
        </div>
        <div className="py-4 flex items-center">
          <div className="w-[240px] h-[380px] relative">
            <img
              src="/sample.png"
              alt="Sample"
              className="w-full h-full object-cover rounded-2xl shadow-lg"
              style={{
                transform: 'rotateZ(3deg)',
                boxShadow: '0 0 40px rgba(56,189,248,0.3)',
              }}
            />
            {samples?.length > 0 && samples.map((sample, samplesKey) => (
              <video
                key={samplesKey}
                playsInline muted loop autoPlay
                className="rounded-2xl overflow-hidden absolute inset-0 w-full h-full object-cover transition-all duration-300"
                style={{
                  opacity: samplesKey === activeSampleIndex ? '1' : '0',
                  transform: 'rotateZ(3deg)',
                  boxShadow: '0 0 40px rgba(56,189,248,0.3)',
                }}
                src={'http://localhost:8080/' + sample + '/final.mp4'}
              />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}

export default App
