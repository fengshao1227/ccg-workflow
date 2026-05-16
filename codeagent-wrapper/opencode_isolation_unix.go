//go:build !windows
// +build !windows

package main

import (
	"os/exec"
	"syscall"
)

func isolateOpencodeExecCmd(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setsid = true
}
