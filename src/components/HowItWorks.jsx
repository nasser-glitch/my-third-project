export default function HowItWorks() {
  return (
    <div className="hiw">
      <p className="hiw-intro">
        Everyone is randomly assigned <strong>2 countries</strong> at draw time.
        Points are earned for each of your teams throughout the tournament.
        The participant with the most total points wins a <strong>digital trophy</strong>. 🏆
      </p>

      <div className="hiw-section">
        <h3 className="hiw-section-title">Group Stage</h3>
        <p className="hiw-section-note">Each win scores independently — points accumulate across all 3 matches.</p>
        <table className="hiw-table">
          <thead>
            <tr><th>Result</th><th>Points</th></tr>
          </thead>
          <tbody>
            <tr><td>Win</td><td className="hiw-pts">+2 pts</td></tr>
            <tr><td>Draw or Loss</td><td className="hiw-pts hiw-zero">0 pts</td></tr>
          </tbody>
        </table>
        <p className="hiw-example">e.g. 3 wins in the group stage = 6 pts total</p>
      </div>

      <div className="hiw-section">
        <h3 className="hiw-section-title">Knockout Rounds</h3>
        <p className="hiw-section-note">Only your team's <strong>highest round reached</strong> counts — points are not cumulative.</p>
        <table className="hiw-table">
          <thead>
            <tr><th>Round reached</th><th>Points</th></tr>
          </thead>
          <tbody>
            <tr><td>Round of 32</td><td className="hiw-pts">3</td></tr>
            <tr><td>Round of 16</td><td className="hiw-pts">5</td></tr>
            <tr><td>Quarter-Final</td><td className="hiw-pts">8</td></tr>
            <tr><td>Semi-Final</td><td className="hiw-pts">12</td></tr>
            <tr><td>3rd Place Play-off — <strong>winner</strong></td><td className="hiw-pts">15</td></tr>
            <tr><td>3rd Place Play-off — <em>loser</em></td><td className="hiw-pts hiw-dim">12 (SF level)</td></tr>
            <tr><td>Final — runner-up</td><td className="hiw-pts">17</td></tr>
            <tr className="hiw-champion-row"><td>🏆 Champion</td><td className="hiw-pts">20</td></tr>
          </tbody>
        </table>
        <p className="hiw-example">e.g. reaching the QF = 8 pts, not 3 + 5 + 8</p>
      </div>

      <div className="hiw-section">
        <h3 className="hiw-section-title">Underdog Bonus</h3>
        <p className="hiw-section-note">A multiplier applied to your team's <strong>total points</strong> (group + knockout combined), based on their rank among the 48 WC teams.</p>
        <table className="hiw-table">
          <thead>
            <tr><th>WC Rank</th><th>Multiplier</th></tr>
          </thead>
          <tbody>
            <tr><td>1 – 10</td><td className="hiw-pts hiw-dim">×1.0 — no bonus</td></tr>
            <tr><td>11 – 20</td><td className="hiw-pts">×1.1</td></tr>
            <tr><td>21 – 32</td><td className="hiw-pts">×1.25</td></tr>
            <tr><td>33 – 48</td><td className="hiw-pts">×1.4</td></tr>
          </tbody>
        </table>
        <p className="hiw-example">WC rank = team's position among the 48 qualified nations by FIFA ranking (1 = highest ranked)</p>
      </div>

      <div className="hiw-formula">
        <span className="hiw-formula-label">Formula</span>
        <span className="hiw-formula-text">(group wins × 2 + knockout pts) × underdog multiplier</span>
      </div>
    </div>
  );
}
