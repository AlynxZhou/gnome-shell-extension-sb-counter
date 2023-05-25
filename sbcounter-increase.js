#!/usr/bin/gjs
"use strict";

const {GLib, Gio} = imports.gi;
const UNIX_SOCKET_ADDRESS = `${GLib.get_tmp_dir()}/sbcounter.${GLib.get_user_name()}.socket`;

try {
  const client = new Gio.SocketClient();
  const socketAddress = new Gio.UnixSocketAddress({
    "path": UNIX_SOCKET_ADDRESS
  });
  const connection = client.connect(socketAddress, null);
  if (!connection) {
    throw new Error("Connection failed.");
  }
  const input = connection.get_input_stream();
  const output = connection.get_output_stream();
  output.write_bytes(new GLib.Bytes("a"), null);
  connection.close(null);
} catch (error) {
  logError(error);
}
