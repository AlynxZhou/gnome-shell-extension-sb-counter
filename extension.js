/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const {GObject, St, Clutter, GLib, Gio} = imports.gi;

const Main = imports.ui.main;
const UNIX_SOCKET_ADDRESS = `${GLib.get_tmp_dir()}/sbcounter.${GLib.get_user_name()}.socket`;

const Indicator = GObject.registerClass(
  class Indicator extends St.Bin {
    _init(monitor, text) {
      super._init();

      this._monitor = monitor;
      this._overviewHiddenID = 0;
      this._label = new St.Label({
        "style_class": "osd-monitor-label",
        "text": text
      });
      this.set_child(this._label);

      // When GNOME Shell starting, it's in overview, many widgets are resized,
      // so we get a smaller size. To prevent this, delay position updating to
      // overview hidden if indicator is created in overview.
      //
      // `Main.layoutManager._inOverview` is not set to true during starting up,
      // so we also need to check `Main.layoutManager._startingUp`.
      if (Main.layoutManager._inOverview || Main.layoutManager._startingUp) {
        this._overviewHiddenID = Main.overview.connect("hidden", () => {
          this._update_position();
          if (this._overviewHiddenID !== 0) {
            Main.overview.disconnect(this._overviewHiddenID);
            this._overviewHiddenID = 0;
          }
        });
      } else {
        this._update_position();
      }
    }

    _update_position() {
      /**
       * Not sure why adding indicators into `window_group` does not work, it
       * always re-sort and put indicators at top.
       * uiGroup
       *     |- window_group
       *     |   |- backgroundGroup
       *     |   |   |- backgroundActor
       *     |   |   |- backgroundActor
       *     |   |   |- indicator          <= Here!
       *     |   |   |- indicator          <= Here!
       *     |   |- window_actor
       *     |   |- window_actor
       *     |   |- window_actor
       *     |- overviewGroup
       *     |- screenshieldGroup
       *     |- panelBox
       *     |- top_window_group
       *     |- modelDialogGroup
       *     |- keyboardBox
       *     |- screenshotUIGroup
       */
      Main.layoutManager._backgroundGroup.add_child(this);
      Main.layoutManager._backgroundGroup.set_child_above_sibling(this, null);

      const workArea = Main.layoutManager.getWorkAreaForMonitor(this._monitor);

      this.x = workArea.x + (workArea.width - this.width);
      this.y = workArea.y + (workArea.height - this.height);
    }

    setText(text) {
      this._label.set_text(text);
      this._update_position();
    }
  });

class Extension {
  constructor(uuid) {
    this._uuid = uuid;
    this._counter = 0;
    this._indicators = [];

    // It looks like GNOME Shell won't call `disable()` on logout.
    const socket = Gio.File.new_for_path(UNIX_SOCKET_ADDRESS);
    if (socket.query_exists(null)) {
      socket.delete(null);
    }
  }

  _createIndicators() {
    const monitors = Main.layoutManager.monitors;
    for (const monitor of monitors) {
      this._indicators.push(new Indicator(monitor.index, `${this._counter}`));
    }
  }

  _destroyIndicators() {
    for (const indicator of this._indicators) {
      indicator.destroy();
    }
    this._indicators = [];
  }

  enable() {
    this._createIndicators();
    Main.layoutManager.connect("monitors-changed", () => {
      this._destroyIndicators();
      this._createIndicators();
    });

    this._service = new Gio.SocketService();
    this._socketAddress = new Gio.UnixSocketAddress({
      "path": UNIX_SOCKET_ADDRESS
    });
    this._service.add_address(
      this._socketAddress,
      Gio.SocketType.STREAM,
      Gio.SocketProtocol.DEFAULT,
      null
    );
    this._service.connect("incoming", (service, connection, channel) => {
      const input = connection.get_input_stream();
      const output = connection.get_output_stream();
      const request = String.fromCharCode.apply(
        null,
        input.read_bytes(1, null).get_data()
      );
      switch (request) {
      case "a":
      case "i":
        ++this._counter;
        break;
      case "r":
      case "c":
        this.counter = 0;
        break;
      default:
        break;
      }
      for (const indicator of this._indicators) {
        indicator.setText(`${this._counter}`);
      }
      // output.write_bytes(new GLib.Bytes(`${this._counter}`), null);
      connection.close(null);
    });
    this._service.start();
  }

  disable() {
    this._service.stop();
    this._service.close();
    this._service = null;
    const socket = Gio.File.new_for_path(UNIX_SOCKET_ADDRESS);
    if (socket.query_exists(null)) {
      socket.delete(null);
    }

    this._destroyIndicators();
  }
}

function init(meta) {
  return new Extension(meta.uuid);
}
