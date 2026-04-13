import { useState, useRef, useCallback, useEffect } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import {
  Scissors, Info, Link, UploadCloud, Image, X,
  Minus, Plus, Eye, EyeOff, Pen, Download,
  RotateCcw, ChevronDown, ChevronUp, Layers,
  Maximize2, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react'

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const fmtSize = (b) => b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`
const equalCuts = (h, n) => Array.from({ length: n - 1 }, (_, i) => Math.round(h / n * (i + 1)))

export default function App() {
  /* ── state ─────────────────────────────────────── */
  const [imageFile, setImageFile] = useState(null)
  const [imageEl,   setImageEl]   = useState(null)
  const [objUrl,    setObjUrl]    = useState(null)

  const [splitCount,  setSplitCount]  = useState(5)
  const [cutPos,      setCutPos]      = useState([])

  const [prefix,      setPrefix]      = useState('cut_')
  const [format,      setFormat]      = useState('jpg')
  const [quality,     setQuality]     = useState(90)
  const [maxQuality,  setMaxQuality]  = useState(false)
  const [overlap,     setOverlap]     = useState(0)
  const [advOpen,     setAdvOpen]     = useState(false)

  const [zoom,        setZoom]        = useState(100)
  const [guidelines,  setGuidelines]  = useState(true)
  const [manualMode,  setManualMode]  = useState(false)
  const [dragOver,    setDragOver]    = useState(false)
  const [processing,  setProcessing]  = useState(false)
  const [toast,       setToast]       = useState(null)

  const fileRef      = useRef(null)
  const previewRef   = useRef(null)
  const dragging     = useRef(-1)
  const dragStartY   = useRef(0)
  const dragStartPos = useRef(0)

  /* ── URL param restore ──────────────────────────── */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('count'))   setSplitCount(clamp(+p.get('count') || 5, 1, 50))
    if (p.get('format'))  setFormat(['jpg','png','webp'].includes(p.get('format')) ? p.get('format') : 'jpg')
    if (p.get('quality')) setQuality(clamp(+p.get('quality') || 90, 1, 100))
    if (p.get('maxq'))    setMaxQuality(p.get('maxq') === '1')
    if (p.get('prefix'))  setPrefix(p.get('prefix'))
  }, [])

  /* ── compute cut positions ──────────────────────── */
  useEffect(() => {
    if (!imageEl) { setCutPos([]); return }
    if (!manualMode) setCutPos(equalCuts(imageEl.naturalHeight, splitCount))
  }, [imageEl, splitCount, manualMode])

  /* ── load image ─────────────────────────────────── */
  const loadImg = useCallback((file) => {
    if (!file?.type.startsWith('image/')) { showToast('이미지 파일만 업로드 가능합니다.', 'error'); return }
    if (objUrl) URL.revokeObjectURL(objUrl)
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload  = () => { setImageFile(file); setImageEl(img); setObjUrl(url) }
    img.onerror = () => showToast('이미지를 불러오지 못했습니다.', 'error')
    img.src = url
  }, [objUrl])

  /* ── drag & drop ────────────────────────────────── */
  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true) }
  const onDragLeave = ()  => setDragOver(false)
  const onDrop      = (e) => { e.preventDefault(); setDragOver(false); loadImg(e.dataTransfer.files[0]) }

  /* ── cut-line drag ──────────────────────────────── */
  const onLineDown = useCallback((idx, e) => {
    if (!manualMode) return
    e.preventDefault()
    dragging.current     = idx
    dragStartY.current   = e.clientY
    dragStartPos.current = cutPos[idx]
  }, [manualMode, cutPos])

  useEffect(() => {
    const onMove = (e) => {
      if (dragging.current < 0 || !imageEl) return
      const dy   = (e.clientY - dragStartY.current) / (zoom / 100)
      const newY = clamp(Math.round(dragStartPos.current + dy), 1, imageEl.naturalHeight - 1)
      setCutPos(prev => { const n = [...prev]; n[dragging.current] = newY; return [...n].sort((a,b)=>a-b) })
    }
    const onUp = () => { dragging.current = -1 }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [imageEl, zoom])

  /* ── toast ──────────────────────────────────────── */
  const showToast = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  /* ── share URL ──────────────────────────────────── */
  const copyShare = useCallback(() => {
    const p = new URLSearchParams({ count: splitCount, format, quality: maxQuality ? 100 : quality, maxq: maxQuality ? '1' : '0', prefix })
    const url = `${location.origin}${location.pathname}?${p}`
    navigator.clipboard.writeText(url)
      .then(()  => showToast('공유 URL이 복사되었습니다!', 'success'))
      .catch(()  => showToast('복사 실패 — 브라우저 권한을 확인하세요.', 'error'))
  }, [splitCount, format, quality, maxQuality, prefix])

  /* ── export ZIP ─────────────────────────────────── */
  const handleExport = useCallback(async () => {
    if (!imageEl) { showToast('먼저 이미지를 업로드하세요.', 'error'); return }
    setProcessing(true)
    try {
      const q    = maxQuality ? 1.0 : quality / 100
      const mime = format === 'jpg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp'
      const ext  = format === 'jpg' ? 'jpg' : format
      const bounds = [0, ...cutPos, imageEl.naturalHeight]
      const zip  = new JSZip()
      const dir  = zip.folder(prefix.replace(/[^\w가-힣-]/g, '_') || 'images')

      for (let i = 0; i < bounds.length - 1; i++) {
        const sy = Math.max(0, bounds[i]   - (i > 0                    ? overlap : 0))
        const ey = Math.min(imageEl.naturalHeight, bounds[i+1] + (i < bounds.length - 2 ? overlap : 0))
        const sh = ey - sy
        const cv = document.createElement('canvas')
        cv.width  = imageEl.naturalWidth
        cv.height = sh
        const ctx = cv.getContext('2d', { alpha: format === 'png' })
        if (format !== 'png') { ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cv.width,cv.height) }
        ctx.drawImage(imageEl, 0, sy, imageEl.naturalWidth, sh, 0, 0, imageEl.naturalWidth, sh)
        const blob = await new Promise(r => cv.toBlob(r, mime, q))
        dir.file(`${prefix}${String(i+1).padStart(2,'0')}.${ext}`, await blob.arrayBuffer())
      }

      const zipBlob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } })
      saveAs(zipBlob, `${prefix}images.zip`)
      showToast(`✅ ${bounds.length-1}개 이미지 ZIP 저장 완료!`, 'success')
    } catch (err) {
      console.error(err)
      showToast('저장 중 오류가 발생했습니다.', 'error')
    } finally {
      setProcessing(false)
    }
  }, [imageEl, cutPos, quality, maxQuality, format, prefix, overlap])

  /* ── reset ──────────────────────────────────────── */
  const handleReset = () => {
    setImageFile(null); setImageEl(null)
    if (objUrl) { URL.revokeObjectURL(objUrl); setObjUrl(null) }
    setSplitCount(5); setCutPos([])
    setFormat('jpg'); setQuality(90); setMaxQuality(false)
    setPrefix('cut_'); setZoom(100); setGuidelines(true); setManualMode(false); setOverlap(0)
  }

  /* ── fit zoom ───────────────────────────────────── */
  const fitZoom = () => {
    if (!imageEl || !previewRef.current) return
    const { clientWidth: cw, clientHeight: ch } = previewRef.current
    const fw = Math.floor((cw - 80) / imageEl.naturalWidth  * 100)
    const fh = Math.floor((ch - 80) / imageEl.naturalHeight * 100)
    setZoom(clamp(Math.min(fw, fh), 20, 300))
  }

  /* ── derived ─────────────────────────────────────── */
  const scale   = zoom / 100
  const scaledW = imageEl ? Math.round(imageEl.naturalWidth  * scale) : 0
  const scaledH = imageEl ? Math.round(imageEl.naturalHeight * scale) : 0
  const segCount = cutPos.length + 1

  /* ── render ──────────────────────────────────────── */
  return (
    <div className="flex flex-col h-screen" style={{ fontFamily:'Inter,sans-serif', background:'#F8FAFC' }}>

      {/* NAV */}
      <nav className="flex items-center justify-between px-6 flex-shrink-0" style={{ background:'#0F172A', height:64 }}>
        <div className="flex items-center gap-3">
          <Scissors size={20} className="text-blue-500" />
          <div>
            <div className="text-white font-bold text-sm leading-tight">이미지 커터</div>
            <div className="text-slate-400 text-xs">상세페이지 자동 분할</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyShare} title="현재 설정값을 URL로 공유"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors">
            <Link size={13} /> 공유 URL 복사
          </button>
          <div className="w-px h-4 bg-slate-700" />
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-slate-400 hover:bg-slate-800 transition-colors">
            <Info size={13} /> 도움말
          </button>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">

        {/* LEFT PANEL */}
        <aside className="w-96 bg-white border-r border-slate-200 flex flex-col overflow-y-auto flex-shrink-0">

          {/* Upload */}
          <section className="p-5 flex flex-col gap-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">이미지 업로드</p>
            {!imageEl ? (
              <div onClick={() => fileRef.current?.click()}
                onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none
                  ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-slate-100'}`}
                style={{ height:148 }}>
                <UploadCloud size={32} className={dragOver ? 'text-blue-400' : 'text-slate-300'} />
                <p className="text-xs text-slate-500 text-center leading-relaxed">
                  이미지를 드래그하거나<br/>클릭하여 업로드
                </p>
                <p className="text-xs text-slate-400">JPG · PNG · WebP · 최대 100MB</p>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => loadImg(e.target.files[0])} />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="relative rounded-xl overflow-hidden bg-slate-100" style={{ height:90 }}>
                  <img src={objUrl} alt="preview" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
                    <span className="text-xs text-white font-medium truncate pr-2">{imageFile.name}</span>
                    <span className="text-xs text-white/70 flex-shrink-0">{imageEl.naturalWidth}×{imageEl.naturalHeight}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-blue-50 rounded-lg px-3 py-2">
                  <Image size={14} className="text-blue-500 flex-shrink-0" />
                  <span className="text-xs text-blue-700 font-medium flex-1 truncate">{imageFile.name}</span>
                  <span className="text-xs text-slate-400 flex-shrink-0">{fmtSize(imageFile.size)}</span>
                  <button onClick={handleReset} className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}
          </section>

          <div className="h-px bg-slate-100" />

          {/* Split settings */}
          <section className="p-5 flex flex-col gap-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">분할 설정</p>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-500">분할 갯수</label>
              {/* Stepper */}
              <div className="flex items-center rounded-xl overflow-hidden border border-slate-200" style={{ height:48 }}>
                <button onClick={() => { setSplitCount(n => clamp(n-1,1,50)); setManualMode(false) }}
                  className="w-12 h-full flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors border-r border-slate-200">
                  <Minus size={14} className="text-slate-500" />
                </button>
                <div className="flex-1 h-full flex items-center justify-center gap-1.5 bg-white">
                  <input type="number" value={splitCount} min={1} max={50}
                    onChange={e => { const n = parseInt(e.target.value); if(!isNaN(n)) { setSplitCount(clamp(n,1,50)); setManualMode(false) } }}
                    className="w-10 text-center text-xl font-extrabold text-slate-900 outline-none bg-transparent" />
                  <span className="text-sm font-semibold text-slate-400">개</span>
                </div>
                <button onClick={() => { setSplitCount(n => clamp(n+1,1,50)); setManualMode(false) }}
                  className="w-12 h-full flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors border-l border-slate-200">
                  <Plus size={14} className="text-slate-500" />
                </button>
              </div>
              {imageEl && (
                <p className="text-xs text-slate-400">
                  각 <span className="font-semibold text-slate-600">{Math.round(imageEl.naturalHeight / splitCount).toLocaleString()}px</span> 높이로 분할
                </p>
              )}
            </div>

            {/* Presets */}
            <div className="flex gap-2">
              {[3,5,8,10].map(n => (
                <button key={n} onClick={() => { setSplitCount(n); setManualMode(false) }}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all
                    ${splitCount===n ? 'bg-blue-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {n}개
                </button>
              ))}
            </div>
          </section>

          <div className="h-px bg-slate-100" />

          {/* Output settings */}
          <section className="p-5 flex flex-col gap-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">출력 설정</p>

            {/* Prefix */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500">파일명 접두사</label>
              <div className="flex items-center h-10 border border-slate-200 rounded-lg bg-slate-50 px-3 gap-2 focus-within:border-blue-400 focus-within:bg-white transition-colors">
                <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="cut_"
                  className="flex-1 text-sm text-slate-800 bg-transparent outline-none" />
                <span className="text-xs text-slate-400">001.jpg</span>
              </div>
            </div>

            {/* Format toggle */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500">저장 형식</label>
              <div className="flex p-1 bg-slate-100 rounded-xl gap-1">
                {['jpg','png','webp'].map(f => (
                  <button key={f} onClick={() => setFormat(f)}
                    className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all
                      ${format===f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality */}
            {format !== 'png' ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500">{format==='jpg'?'JPG':'WebP'} 품질</label>
                  <span className="text-xs font-bold text-blue-500">{maxQuality ? '100%' : `${quality}%`}</span>
                </div>
                <input type="range" min={1} max={100}
                  value={maxQuality ? 100 : quality}
                  onChange={e => { setMaxQuality(false); setQuality(+e.target.value) }}
                  disabled={maxQuality} className="w-full" style={{ accentColor:'#3b82f6' }} />

                {/* Max quality toggle */}
                <label className="flex items-center gap-3 cursor-pointer p-3 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors">
                  <div onClick={() => setMaxQuality(p => !p)}
                    className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${maxQuality ? 'bg-blue-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${maxQuality ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">최고 화질 모드</p>
                    <p className="text-xs text-slate-500">무손실 최대 품질로 저장</p>
                  </div>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2.5">
                <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                <p className="text-xs text-green-700 font-medium">PNG는 무손실 최고 화질 자동 저장</p>
              </div>
            )}
          </section>

          <div className="h-px bg-slate-100" />

          {/* Advanced */}
          <section>
            <button onClick={() => setAdvOpen(p => !p)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
              <div className="text-left">
                <p className="text-xs font-semibold text-slate-700">고급 설정</p>
                <p className="text-xs text-slate-400 mt-0.5">여백 · 겹침 · 세부 설정</p>
              </div>
              {advOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
            </button>

            {advOpen && (
              <div className="px-5 pb-5 border-t border-slate-100 pt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-500">컷 영역 여백 (겹침)</label>
                    <span className="text-xs font-bold text-blue-500">{overlap}px</span>
                  </div>
                  <input type="range" min={0} max={100} value={overlap}
                    onChange={e => setOverlap(+e.target.value)} className="w-full" style={{ accentColor:'#3b82f6' }} />
                  <p className="text-xs text-slate-400">인접 구간에 {overlap}px씩 추가해 컷 경계 손실 방지</p>
                </div>
                <button onClick={() => { setManualMode(false); if(imageEl) setCutPos(equalCuts(imageEl.naturalHeight, splitCount)) }}
                  className="flex items-center justify-center gap-2 h-9 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                  <RotateCcw size={13} /> 컷팅 위치 균등 분할로 초기화
                </button>
              </div>
            )}
          </section>
          <div className="flex-1" />
        </aside>

        {/* MAIN */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 bg-white border-b border-slate-200 flex-shrink-0" style={{ height:52 }}>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-full">
                <Layers size={13} className="text-blue-500" />
                <span className="text-xs font-semibold text-blue-600">총 {segCount}개 이미지로 분할</span>
              </div>
              <div className="w-px h-5 bg-slate-200" />
              <button onClick={() => setManualMode(p => !p)}
                title="빨간 선을 드래그해서 컷 위치를 직접 조정"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                  ${manualMode ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100'}`}>
                <Pen size={13} />
                {manualMode ? '수동 조정 중 ✓' : '수동 조정'}
              </button>
              {manualMode && (
                <p className="text-xs text-orange-500 font-medium animate-pulse">↕ 빨간 선을 드래그하여 위치 조정</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Zoom */}
              <div className="flex items-center border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <button onClick={() => setZoom(z => clamp(z-10, 20, 300))}
                  className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 transition-colors">
                  <Minus size={12} className="text-slate-500" />
                </button>
                <div className="w-px h-4 bg-slate-200" />
                <button onClick={() => setZoom(100)}
                  className="px-2 h-8 text-xs font-bold text-slate-700 hover:bg-slate-100 min-w-14 text-center">
                  {zoom}%
                </button>
                <div className="w-px h-4 bg-slate-200" />
                <button onClick={() => setZoom(z => clamp(z+10, 20, 300))}
                  className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 transition-colors">
                  <Plus size={12} className="text-slate-500" />
                </button>
              </div>
              <button onClick={fitZoom} title="화면에 맞추기"
                className="w-8 h-8 flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                <Maximize2 size={13} className="text-slate-500" />
              </button>
              {/* Guidelines */}
              <button onClick={() => setGuidelines(p => !p)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border
                  ${guidelines ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                {guidelines ? <Eye size={13} /> : <EyeOff size={13} />}
                가이드라인 {guidelines ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Preview */}
          <div ref={previewRef} className="flex-1 overflow-auto" style={{ background:'#1E293B' }}>
            {!imageEl ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 select-none">
                <Image size={48} className="text-slate-600 opacity-30" />
                <p className="text-sm font-semibold text-slate-500">이미지를 업로드하면 미리보기가 표시됩니다</p>
                <p className="text-xs text-slate-600">좌측 패널에서 이미지를 업로드하세요</p>
              </div>
            ) : (
              <div className="flex items-start justify-center p-8 min-h-full" style={{ userSelect:'none' }}>
                <div className="relative flex-shrink-0" style={{ width:scaledW, height:scaledH }}>
                  <img src={objUrl} alt="preview" draggable={false}
                    style={{ width:scaledW, height:scaledH, display:'block' }} />

                  {/* Cut lines */}
                  {guidelines && cutPos.map((pos, idx) => {
                    const y = Math.round(pos * scale)
                    return (
                      <div key={idx}
                        style={{ position:'absolute', left:0, top: y - 1, width:'100%', zIndex:10,
                          cursor: manualMode ? 'ns-resize' : 'default' }}
                        onMouseDown={e => onLineDown(idx, e)}>

                        {/* Line */}
                        <div style={{ height:2, background:'#EF4444', boxShadow:'0 0 8px rgba(239,68,68,0.7)' }} />

                        {/* Left badge */}
                        <div style={{ position:'absolute', left:-40, top:-10,
                          background:'#EF4444', color:'#fff', fontSize:10, fontWeight:800,
                          padding:'2px 6px', borderRadius:4, lineHeight:1.5, letterSpacing:'0.05em' }}>
                          {String(idx+1).padStart(2,'0')}
                        </div>

                        {/* Center drag handle (manual mode) */}
                        {manualMode && (
                          <div style={{ position:'absolute', left:'50%', top:-9, transform:'translateX(-50%)',
                            background:'#EF4444', color:'#fff', padding:'2px 10px', borderRadius:20,
                            fontSize:10, fontWeight:700, cursor:'ns-resize', whiteSpace:'nowrap',
                            boxShadow:'0 2px 8px rgba(239,68,68,0.5)' }}>
                            ↕ 드래그
                          </div>
                        )}

                        {/* Right pixel label */}
                        <div style={{ position:'absolute', right:-62, top:-9,
                          fontSize:10, color:'#94a3b8', fontWeight:600, whiteSpace:'nowrap' }}>
                          {pos.toLocaleString()}px
                        </div>
                      </div>
                    )
                  })}

                  {/* Segment number labels */}
                  {guidelines && imageEl && (() => {
                    const segs = [0, ...cutPos, imageEl.naturalHeight]
                    return segs.slice(0,-1).map((sy, i) => {
                      const ey   = segs[i+1]
                      const midY = Math.round((sy + ey) / 2 * scale)
                      return (
                        <div key={i} style={{ position:'absolute', left:8, top: midY - 12, pointerEvents:'none',
                          background:'rgba(0,0,0,0.4)', backdropFilter:'blur(4px)',
                          color:'#fff', fontSize:11, fontWeight:800, padding:'2px 8px',
                          borderRadius:6, letterSpacing:'0.06em' }}>
                          {String(i+1).padStart(2,'0')}
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between px-6 bg-white border-t border-slate-200 flex-shrink-0" style={{ height:72 }}>
            <div>
              {imageEl ? (
                <>
                  <p className="text-sm font-bold text-slate-800">
                    {splitCount}개로 {manualMode ? '수동' : '균등'} 분할
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {format.toUpperCase()} · {maxQuality ? '최고 화질' : `품질 ${quality}%`}
                    {overlap > 0 && ` · 겹침 ${overlap}px`}
                    {' '}· {imageEl.naturalWidth}×{imageEl.naturalHeight}px
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-400">이미지를 업로드하면 분할이 시작됩니다</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                <RotateCcw size={14} /> 초기화
              </button>
              <button onClick={handleExport} disabled={!imageEl || processing}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all
                  ${!imageEl || processing ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 shadow-sm hover:shadow-md'}`}>
                {processing
                  ? <><Loader2 size={15} className="spin" /> 처리 중...</>
                  : <><Download size={15} /> ZIP으로 저장</>}
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl text-sm font-semibold z-50
          ${toast.type==='success' ? 'bg-green-500 text-white' : toast.type==='error' ? 'bg-red-500 text-white' : 'bg-slate-800 text-white'}`}>
          {toast.type==='success' && <CheckCircle2 size={15} />}
          {toast.type==='error'   && <AlertCircle  size={15} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}
