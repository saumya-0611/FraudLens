import { Link } from "react-router-dom";
import { Activity, ArrowRight, ShieldCheck } from "lucide-react";
import "./LandingPage.css";

const processingModes = [
  { title: "Inline scoring mode", label: "Configured by the checked-in Render blueprint", steps: ["Transaction API", "Inline feature calculation", "ML service prediction", "PostgreSQL result and alert"] },
  { title: "Kafka and Spark streaming mode", label: "Streaming architecture available in the project", steps: ["Transaction API", "Kafka transaction topic", "Spark feature and scoring pipeline", "PostgreSQL result and alert"] },
];

const capabilities = [
  ["Transaction monitoring", "Review transaction activity returned by the configured backend."],
  ["Fraud probability scoring", "Review model scores alongside each transaction."],
  ["Anomaly detection", "Surface unusual behavior for analyst attention."],
  ["Risk classification", "Group outcomes as legitimate, suspicious, or high risk."],
  ["Alert management", "Review alerts and record a resolution."],
  ["Access and audit controls", "Role-based screens and recorded administrative events."],
];

const technologies = ["React", "Express", "Kafka", "Apache Spark", "PostgreSQL", "FastAPI", "Docker"];

function Brand() {
  return <Link className="landing-brand" to="/home" aria-label="FraudLens home">
    <span className="landing-brand-mark"><ShieldCheck size={22} /></span>
    <span>Fraud<span className="landing-brand-accent">Lens</span></span>
  </Link>;
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-nav-wrap">
        <nav className="landing-nav" aria-label="Main navigation">
          <Brand />
          <div className="landing-nav-links">
            <a href="#home">Home</a>
            <a href="#overview">Overview</a>
            <a href="#how-it-works">How it works</a>
            <a href="#technology">Technology</a>
          </div>
          <Link className="landing-login" to="/">Login <ArrowRight size={16} /></Link>
        </nav>
      </header>

      <section className="landing-hero landing-container" id="home">
        <div className="landing-hero-copy">
          <span className="landing-kicker"><i /> FRAUD MONITORING PLATFORM</span>
          <h1>Real-Time Financial <span>Fraud Detection.</span></h1>
          <p>FraudLens accepts transaction data, combines machine-learning risk scores with anomaly signals, and gives teams a place to review suspicious activity.</p>
          <div className="landing-actions">
            <Link className="landing-primary" to="/">Get started <ArrowRight size={17} /></Link>
            <a className="landing-secondary" href="#how-it-works">Explore how it works</a>
          </div>
        <div className="landing-proof"><span><ShieldCheck size={16} /> Role-aware access</span><span><Activity size={16} /> Model-assisted review</span></div>
        </div>

        <div className="landing-visual" aria-label="Illustration of a transaction moving through fraud review" role="img">
          <div className="visual-topline"><span>TRANSACTION REVIEW</span><span className="visual-state"><i /> PIPELINE</span></div>
          <div className="visual-transaction"><div className="visual-transaction-icon"><Activity size={20} /></div><div><small>Incoming event</small><strong>Transaction signal</strong></div><span className="visual-arrow"><ArrowRight size={17} /></span></div>
          <div className="visual-flow"><span /><span /><span /></div>
          <div className="visual-result"><div><span className="visual-label">MODEL OUTPUT</span><strong>Risk classification</strong><small>Probability scoring · anomaly signal</small></div><span className="visual-risk">REVIEW</span></div>
          <div className="visual-divider" />
          <div className="visual-footer"><span><i className="visual-green" /> Reviewed by role</span><span><i className="visual-blue" /> Recorded to audit trail</span></div>
          <div className="visual-caption">Illustrative workflow · no live operational metrics</div>
        </div>
      </section>

      <section className="landing-overview" id="overview">
        <div className="landing-container landing-overview-grid">
          <div><span className="landing-kicker">THE CHALLENGE</span><h2>Fraud moves quickly.<br /><span>Detection should keep pace.</span></h2></div>
          <p>When transaction review depends on delayed or disconnected signals, suspicious activity can take longer to reach the people who need to investigate it. FraudLens brings transaction monitoring, risk review, and alert management into one configured processing workflow.</p>
        </div>
      </section>

      <section className="landing-section landing-container" id="how-it-works">
        <div className="landing-section-heading"><span className="landing-kicker">PROCESSING MODES</span><h2>How FraudLens works</h2><p>The project supports two processing paths. They are alternatives, not consecutive stages.</p></div>
        <div className="processing-modes">
          {processingModes.map(mode => <article className="processing-mode panel" key={mode.title}><div><h3>{mode.title}</h3><p>{mode.label}</p></div><ol>{mode.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span>{step}</li>)}</ol></article>)}
        </div>
        <p className="pipeline-evidence-note">The Render blueprint selects inline mode. The presence of streaming code does not mean Kafka/Spark or a public deployment is currently running.</p>
      </section>

      <section className="landing-capabilities">
        <div className="landing-container">
          <div className="landing-section-heading"><span className="landing-kicker">BUILT FOR REVIEW</span><h2>Signals your team can act on</h2></div>
          <div className="capability-list">{capabilities.map(([title, text], index) => <article className="capability-item" key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
        </div>
      </section>

      <section className="landing-section landing-container landing-technology" id="technology">
        <div><span className="landing-kicker">IMPLEMENTED STACK</span><h2>Built on a streaming architecture</h2><p>FraudLens connects a web dashboard to backend services, event streaming, model inference, and persistent operational data.</p></div>
        <ul className="technology-list">{technologies.map(technology => <li key={technology}>{technology}</li>)}</ul>
      </section>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner"><div><Brand /><p>Real-time transaction monitoring and fraud review for financial operations.</p></div><div className="footer-links"><a href="#home">Home</a><a href="#overview">Overview</a><a href="#how-it-works">How it works</a><a href="#technology">Technology</a><Link to="/">Login</Link></div><small>FraudLens · Financial fraud monitoring platform</small></div>
      </footer>
    </main>
  );
}
